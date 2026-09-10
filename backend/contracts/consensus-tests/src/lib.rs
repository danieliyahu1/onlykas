#[cfg(test)]
mod tests {
    use kaspa_consensus_core::Hash;
    use kaspa_consensus_core::hashing::sighash::{SigHashReusedValuesUnsync, calc_schnorr_signature_hash};
    use kaspa_consensus_core::hashing::sighash_type::SIG_HASH_ALL;
    use kaspa_consensus_core::mass::{Mass, MassCalculator};
    use kaspa_consensus_core::tx::{
        CovenantBinding, MutableTransaction, PopulatedTransaction, ScriptPublicKey, Transaction,
        TransactionId, TransactionInput, TransactionOutpoint, TransactionOutput, UtxoEntry,
        VerifiableTransaction,
    };
    use kaspa_txscript::caches::Cache;
    use kaspa_txscript::covenants::CovenantsContext;
    use kaspa_txscript::script_builder::ScriptBuilder;
    use kaspa_txscript::{EngineCtx, EngineFlags, TxScriptEngine, pay_to_script_hash_script};
    use kaspa_txscript_errors::TxScriptError;
    use secp256k1::{Keypair, Message, Secp256k1, SecretKey};
    use silverscript_lang::ast::Expr;
    use silverscript_lang::compiler::{CompileOptions, CompiledContract, compile_contract};

    const DEPOSIT: u64 = 50_000_000;
    const PRICE: u64 = 100_000_000;
    const DAA: u64 = 500_000;
    const EXPIRY: i64 = 1_364_000;
    const COMPUTE_BUDGET: u16 = 50;
    const COVENANT_ID: Hash = Hash::from_bytes(*b"onlykas-membership-test-family-1");

    fn key(seed: u8) -> Keypair {
        Keypair::from_secret_key(
            &Secp256k1::new(),
            &SecretKey::from_slice(&[seed; 32]).expect("valid deterministic test key"),
        )
    }

    fn p2pk(public_key: &[u8]) -> ScriptPublicKey {
        let mut script = vec![0x20];
        script.extend_from_slice(public_key);
        script.push(0xac);
        ScriptPublicKey::new(0, script.into())
    }

    fn compile(creator: &[u8]) -> CompiledContract<'static> {
        let source = include_str!("../../membership.sil");
        compile_contract(
            source,
            &[
                Expr::bytes(creator.to_vec()),
                Expr::bytes(creator.to_vec()),
                Expr::int(0),
                Expr::bool(true),
            ],
            CompileOptions::default(),
        )
        .expect("stable SilverScript compiles Membership")
    }

    fn state(compiled: &CompiledContract, creator: &[u8], owner: &[u8], expiry: i64, minter: bool) -> Vec<u8> {
        let mut encoded = Vec::with_capacity(compiled.state_layout.len);
        for value in [creator, owner] {
            encoded.push(32);
            encoded.extend_from_slice(value);
        }
        encoded.push(8);
        encoded.extend_from_slice(&expiry.to_le_bytes());
        encoded.extend_from_slice(&[1, u8::from(minter)]);
        assert_eq!(encoded.len(), compiled.state_layout.len);
        let mut script = compiled.bytecode.clone();
        script.splice(compiled.state_layout.start..compiled.state_layout.start + compiled.state_layout.len, encoded);
        script
    }

    fn covenant_signature_script(
        compiled: &CompiledContract,
        current: &[u8],
        creator: &[u8],
        member: &[u8],
    ) -> Vec<u8> {
        let mut builder = ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, ..Default::default() });
        builder.add_data(&[creator, creator].concat()).unwrap();
        builder.add_data(&[creator, member].concat()).unwrap();
        builder.add_data(&[0i64.to_le_bytes(), EXPIRY.to_le_bytes()].concat()).unwrap();
        builder.add_data(&[1, 0]).unwrap();
        builder.add_data(&[1]).unwrap();
        builder.add_data(&[2]).unwrap();
        builder.add_data(&[3]).unwrap();
        builder.add_data(compiled.dispatch_tags.values().next().expect("mint dispatch tag")).unwrap();
        builder.add_data(current).unwrap();
        builder.drain()
    }

    fn buyer_signature(tx: &Transaction, entries: &[UtxoEntry], buyer: &Keypair) -> Vec<u8> {
        let mutable = MutableTransaction::with_entries(tx.clone(), entries.to_vec());
        let hash = calc_schnorr_signature_hash(&mutable.as_verifiable(), 1, SIG_HASH_ALL, &SigHashReusedValuesUnsync::new());
        let signature = buyer.sign_schnorr(Message::from_digest_slice(hash.as_bytes().as_slice()).unwrap());
        let mut bytes = signature.as_ref().to_vec();
        bytes.push(SIG_HASH_ALL.to_u8());
        ScriptBuilder::new().add_data(&bytes).unwrap().drain()
    }

    fn execute(tx: &Transaction, entries: &[UtxoEntry], index: usize) -> Result<(), TxScriptError> {
        let populated = PopulatedTransaction::new(tx, entries.to_vec());
        let context = CovenantsContext::from_tx(&populated).map_err(TxScriptError::from)?;
        let reused = SigHashReusedValuesUnsync::new();
        let cache = Cache::new(10_000);
        let mut engine = TxScriptEngine::from_transaction_input(
            &populated,
            &tx.inputs[index],
            index,
            populated.utxo(index).unwrap(),
            EngineCtx::new(&cache).with_reused(&reused).with_covenants_ctx(&context),
            EngineFlags { covenants_enabled: true, sigop_script_units: 0.into() },
        );
        engine.execute()
    }

    #[test]
    fn membership_mint_passes_consensus_vm_and_mass_limit() {
        let creator = key(1);
        let buyer = key(2);
        let creator_key = creator.x_only_public_key().0.serialize();
        let buyer_key = buyer.x_only_public_key().0.serialize();
        let compiled = compile(&creator_key);
        let minter = state(&compiled, &creator_key, &creator_key, 0, true);
        let member = state(&compiled, &creator_key, &buyer_key, EXPIRY, false);
        let buyer_spk = p2pk(&buyer_key);
        let entries = vec![
            UtxoEntry::new(DEPOSIT, pay_to_script_hash_script(&minter), 1, false, Some(COVENANT_ID)),
            UtxoEntry::new(500_000_000, buyer_spk.clone(), 1, false, None),
        ];
        let unsigned = Transaction::new(
            1,
            vec![
                TransactionInput::new_with_compute_budget(
                    TransactionOutpoint { transaction_id: TransactionId::from_bytes([1; 32]), index: 0 },
                    covenant_signature_script(&compiled, &minter, &creator_key, &buyer_key),
                    0,
                    COMPUTE_BUDGET,
                ),
                TransactionInput::new_with_compute_budget(
                    TransactionOutpoint { transaction_id: TransactionId::from_bytes([2; 32]), index: 0 },
                    vec![],
                    0,
                    COMPUTE_BUDGET,
                ),
            ],
            vec![
                TransactionOutput { value: DEPOSIT, script_public_key: pay_to_script_hash_script(&minter), covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: COVENANT_ID }) },
                TransactionOutput { value: DEPOSIT, script_public_key: pay_to_script_hash_script(&member), covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: COVENANT_ID }) },
                TransactionOutput { value: PRICE, script_public_key: p2pk(&creator_key), covenant: None },
                TransactionOutput { value: DEPOSIT, script_public_key: buyer_spk.clone(), covenant: None },
                TransactionOutput { value: 299_000_000, script_public_key: buyer_spk, covenant: None },
            ],
            DAA,
            Default::default(),
            0,
            vec![],
        );
        let mut inputs = unsigned.inputs.clone();
        inputs[1].signature_script = buyer_signature(&unsigned, &entries, &buyer);
        let tx = Transaction::new(1, inputs, unsigned.outputs, DAA, Default::default(), 0, vec![]);

        assert_eq!(execute(&tx, &entries, 0), Ok(()));
        assert_eq!(execute(&tx, &entries, 1), Ok(()));

        let calculator = MassCalculator::new_with_consensus_params(&kaspa_consensus_core::config::params::TESTNET_PARAMS);
        let non_contextual = calculator.calc_non_contextual_masses(&tx);
        let populated = PopulatedTransaction::new(&tx, entries);
        let contextual = calculator.calc_contextual_masses(&populated).unwrap();
        let normalized = Mass::new(non_contextual, contextual)
            .normalized_max(&kaspa_consensus_core::config::params::TESTNET_PARAMS.prior_block_mass_limits.cofactors());
        assert!(normalized <= 500_000, "transaction mass {normalized} exceeds the network limit");
    }
}
