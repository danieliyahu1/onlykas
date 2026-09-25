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
    const PRICE: u64 = 1_000_000_000;
    const DAA: u64 = 500_000;
    const EXPIRY: i64 = 26_420_000;
    const COMPUTE_BUDGET: u16 = 50;
    const COVENANT_ID: Hash = Hash::from_bytes(*b"kaskama-membership-test-family-1");

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

fn compile(creator: &[u8], platform: &[u8]) -> CompiledContract<'static> {
        let source = include_str!("../../membership.sil");
        compile_contract(
            source,
            &[
                Expr::bytes(creator.to_vec()),
                Expr::bytes(platform.to_vec()),
                Expr::bytes(creator.to_vec()),
                Expr::int(0),
                Expr::int(PRICE as i64),
                Expr::bool(true),
            ],
            CompileOptions::default(),
        )
        .expect("stable SilverScript compiles Membership")
    }

    fn state(
        compiled: &CompiledContract,
        creator: &[u8],
        platform: &[u8],
        owner: &[u8],
        expiry: i64,
        price: i64,
        minter: bool,
    ) -> Vec<u8> {
        let mut encoded = Vec::with_capacity(compiled.state_layout.len);
        for value in [creator, platform, owner] {
            encoded.push(32);
            encoded.extend_from_slice(value);
        }
        encoded.push(8);
        encoded.extend_from_slice(&expiry.to_le_bytes());
        encoded.push(8);
        encoded.extend_from_slice(&price.to_le_bytes());
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
        platform: &[u8],
        member: &[u8],
    ) -> Vec<u8> {
        let mut builder = ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, ..Default::default() });
        builder.add_data(&[creator, creator].concat()).unwrap();
        builder.add_data(&[platform, platform].concat()).unwrap();
        builder.add_data(&[creator, member].concat()).unwrap();
        builder.add_data(&[0i64.to_le_bytes(), EXPIRY.to_le_bytes()].concat()).unwrap();
        builder.add_data(&[PRICE.to_le_bytes(), PRICE.to_le_bytes()].concat()).unwrap();
        builder.add_data(&[1, 0]).unwrap();
        builder.add_data(&[1]).unwrap();
        builder.add_data(&[2]).unwrap();
        builder.add_data(&[3]).unwrap();
        builder.add_data(&[3]).unwrap();
        builder.add_data(compiled.dispatch_tags.get("mint").expect("mint dispatch tag")).unwrap();
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

    fn update_signature_script(
        compiled: &CompiledContract,
        current: &[u8],
        new_price: i64,
    ) -> Vec<u8> {
        let mut builder = ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, ..Default::default() });
        builder.add_data(&new_price.to_le_bytes()).unwrap();
        builder.add_data(&[1]).unwrap();
        builder.add_data(compiled.dispatch_tags.get("__covenant_entrypoint_auth_updateMembership").expect("update dispatch tag")).unwrap();
        builder.add_data(current).unwrap();
        builder.drain()
    }

    fn cancel_signature_script(
        compiled: &CompiledContract,
        current: &[u8],
    ) -> Vec<u8> {
        let mut builder = ScriptBuilder::with_flags(EngineFlags { covenants_enabled: true, ..Default::default() });
        builder.add_data(&[1]).unwrap();
        builder.add_data(compiled.dispatch_tags.get("__covenant_entrypoint_auth_cancelMembership").expect("cancel dispatch tag")).unwrap();
        builder.add_data(current).unwrap();
        builder.drain()
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
        let platform = key(3);
        let buyer = key(2);
        let creator_key = creator.x_only_public_key().0.serialize();
        let platform_key = platform.x_only_public_key().0.serialize();
        let buyer_key = buyer.x_only_public_key().0.serialize();
        let compiled = compile(&creator_key, &platform_key);
        let minter = state(&compiled, &creator_key, &platform_key, &creator_key, 0, PRICE as i64, true);
        let member = state(&compiled, &creator_key, &platform_key, &buyer_key, EXPIRY, PRICE as i64, false);
        let buyer_spk = p2pk(&buyer_key);
        let entries = vec![
            UtxoEntry::new(DEPOSIT, pay_to_script_hash_script(&minter), 1, false, Some(COVENANT_ID)),
            UtxoEntry::new(1_200_000_000, buyer_spk.clone(), 1, false, None),
        ];
        let unsigned = Transaction::new(
            1,
            vec![
                TransactionInput::new_with_compute_budget(
                    TransactionOutpoint { transaction_id: TransactionId::from_bytes([1; 32]), index: 0 },
                    covenant_signature_script(&compiled, &minter, &creator_key, &platform_key, &buyer_key),
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
                TransactionOutput { value: 100_000_000, script_public_key: buyer_spk, covenant: None },
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

    #[test]
    fn membership_price_update_preserves_covenant_and_requires_creator_input() {
        let creator = key(1);
        let platform = key(3);
        let creator_key = creator.x_only_public_key().0.serialize();
        let platform_key = platform.x_only_public_key().0.serialize();
        let compiled = compile(&creator_key, &platform_key);
        let current = state(&compiled, &creator_key, &platform_key, &creator_key, 0, PRICE as i64, true);
        let updated = state(&compiled, &creator_key, &platform_key, &creator_key, 0, 2_000_000_000, true);
        let creator_spk = p2pk(&creator_key);
        let entries = vec![
            UtxoEntry::new(DEPOSIT, pay_to_script_hash_script(&current), 1, false, Some(COVENANT_ID)),
            UtxoEntry::new(1_000_000_000, creator_spk.clone(), 1, false, None),
        ];
        let unsigned = Transaction::new(
            1,
            vec![
                TransactionInput::new_with_compute_budget(
                    TransactionOutpoint { transaction_id: TransactionId::from_bytes([3; 32]), index: 0 },
                    update_signature_script(&compiled, &current, 2_000_000_000),
                    0,
                    COMPUTE_BUDGET,
                ),
                TransactionInput::new_with_compute_budget(
                    TransactionOutpoint { transaction_id: TransactionId::from_bytes([4; 32]), index: 0 },
                    vec![],
                    0,
                    COMPUTE_BUDGET,
                ),
            ],
            vec![
                TransactionOutput { value: DEPOSIT, script_public_key: pay_to_script_hash_script(&updated), covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: COVENANT_ID }) },
                TransactionOutput { value: 900_000_000, script_public_key: creator_spk, covenant: None },
            ],
            DAA,
            Default::default(),
            0,
            vec![],
        );
        let mut inputs = unsigned.inputs.clone();
        inputs[1].signature_script = buyer_signature(&unsigned, &entries, &creator);
        let tx = Transaction::new(1, inputs, unsigned.outputs, DAA, Default::default(), 0, vec![]);

        assert_eq!(execute(&tx, &entries, 0), Ok(()));
        assert_eq!(execute(&tx, &entries, 1), Ok(()));
    }

    #[test]
    fn membership_cancellation_disables_the_minter_and_requires_creator_input() {
        let creator = key(1);
        let platform = key(3);
        let creator_key = creator.x_only_public_key().0.serialize();
        let platform_key = platform.x_only_public_key().0.serialize();
        let compiled = compile(&creator_key, &platform_key);
        let current = state(&compiled, &creator_key, &platform_key, &creator_key, 0, PRICE as i64, true);
        let canceled = state(&compiled, &creator_key, &platform_key, &creator_key, 0, PRICE as i64, false);
        let creator_spk = p2pk(&creator_key);
        let entries = vec![
            UtxoEntry::new(DEPOSIT, pay_to_script_hash_script(&current), 1, false, Some(COVENANT_ID)),
            UtxoEntry::new(1_000_000_000, creator_spk.clone(), 1, false, None),
        ];
        let unsigned = Transaction::new(
            1,
            vec![
                TransactionInput::new_with_compute_budget(
                    TransactionOutpoint { transaction_id: TransactionId::from_bytes([5; 32]), index: 0 },
                    cancel_signature_script(&compiled, &current),
                    0,
                    COMPUTE_BUDGET,
                ),
                TransactionInput::new_with_compute_budget(
                    TransactionOutpoint { transaction_id: TransactionId::from_bytes([6; 32]), index: 0 },
                    vec![],
                    0,
                    COMPUTE_BUDGET,
                ),
            ],
            vec![
                TransactionOutput { value: DEPOSIT, script_public_key: pay_to_script_hash_script(&canceled), covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: COVENANT_ID }) },
                TransactionOutput { value: 900_000_000, script_public_key: creator_spk, covenant: None },
            ],
            DAA,
            Default::default(),
            0,
            vec![],
        );
        assert_eq!(execute(&unsigned, &entries, 0), Ok(()));
    }

    fn mint_transaction(
        compiled: &CompiledContract,
        minter: &[u8],
        _member: &[u8],
        entries: &[UtxoEntry],
        outputs: Vec<TransactionOutput>,
    ) -> Transaction {
        let creator_key = key(1).x_only_public_key().0.serialize();
        let platform_key = key(3).x_only_public_key().0.serialize();
        let buyer_key = key(2).x_only_public_key().0.serialize();
        let unsigned = Transaction::new(
            1,
            vec![
                TransactionInput::new_with_compute_budget(
                    TransactionOutpoint { transaction_id: TransactionId::from_bytes([1; 32]), index: 0 },
                    covenant_signature_script(compiled, minter, &creator_key, &platform_key, &buyer_key),
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
            outputs,
            DAA,
            Default::default(),
            0,
            vec![],
        );
        let mut inputs = unsigned.inputs.clone();
        inputs[1].signature_script = buyer_signature(&unsigned, entries, &key(2));
        Transaction::new(1, inputs, unsigned.outputs, DAA, Default::default(), 0, vec![])
    }

    fn mint_fixture() -> (CompiledContract<'static>, Vec<u8>, Vec<u8>, Vec<UtxoEntry>) {
        let creator_key = key(1).x_only_public_key().0.serialize();
        let platform_key = key(3).x_only_public_key().0.serialize();
        let buyer_key = key(2).x_only_public_key().0.serialize();
        let compiled = compile(&creator_key, &platform_key);
        let minter = state(&compiled, &creator_key, &platform_key, &creator_key, 0, PRICE as i64, true);
        let member = state(&compiled, &creator_key, &platform_key, &buyer_key, EXPIRY, PRICE as i64, false);
        let buyer_spk = p2pk(&buyer_key);
        let entries = vec![
            UtxoEntry::new(DEPOSIT, pay_to_script_hash_script(&minter), 1, false, Some(COVENANT_ID)),
            UtxoEntry::new(1_200_000_000, buyer_spk, 1, false, None),
        ];
        (compiled, minter, member, entries)
    }

    fn valid_mint_outputs(minter: &[u8], member: &[u8]) -> Vec<TransactionOutput> {
        let creator_key = key(1).x_only_public_key().0.serialize();
        let buyer_key = key(2).x_only_public_key().0.serialize();
        let buyer_spk = p2pk(&buyer_key);
        vec![
            TransactionOutput { value: DEPOSIT, script_public_key: pay_to_script_hash_script(minter), covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: COVENANT_ID }) },
            TransactionOutput { value: DEPOSIT, script_public_key: pay_to_script_hash_script(member), covenant: Some(CovenantBinding { authorizing_input: 0, covenant_id: COVENANT_ID }) },
            TransactionOutput { value: PRICE, script_public_key: p2pk(&creator_key), covenant: None },
            TransactionOutput { value: DEPOSIT, script_public_key: buyer_spk.clone(), covenant: None },
            TransactionOutput { value: 100_000_000, script_public_key: buyer_spk, covenant: None },
        ]
    }

    #[test]
    fn mint_rejects_underpayment_to_the_creator() {
        let (compiled, minter, member, entries) = mint_fixture();
        let mut outputs = valid_mint_outputs(&minter, &member);
        outputs[2].value = PRICE - 1;
        assert_eq!(
            execute(&mint_transaction(&compiled, &minter, &member, &entries, outputs), &entries, 0),
            Err(TxScriptError::VerifyError),
        );
    }

    #[test]
    fn mint_rejects_payment_sent_to_the_wrong_key() {
        let (compiled, minter, member, entries) = mint_fixture();
        let attacker_key = key(9).x_only_public_key().0.serialize();
        let mut outputs = valid_mint_outputs(&minter, &member);
        outputs[2].script_public_key = p2pk(&attacker_key);
        assert_eq!(
            execute(&mint_transaction(&compiled, &minter, &member, &entries, outputs), &entries, 0),
            Err(TxScriptError::VerifyError),
        );
    }

    #[test]
    fn mint_rejects_an_output_that_is_not_the_member_output() {
        let (compiled, minter, member, entries) = mint_fixture();
        let mut outputs = valid_mint_outputs(&minter, &member);
        // A member-shaped output at a non-designated index must not satisfy the
        // covenant; only the contract-selected member output carries the state.
        outputs[4].script_public_key = pay_to_script_hash_script(&member);
        outputs[4].covenant = Some(CovenantBinding { authorizing_input: 0, covenant_id: COVENANT_ID });
        assert_eq!(
            execute(&mint_transaction(&compiled, &minter, &member, &entries, outputs), &entries, 0),
            Err(TxScriptError::VerifyError),
        );
    }

    #[test]
    fn mint_rejects_when_the_state_is_not_a_minter() {
        let (compiled, minter, member, entries) = mint_fixture();
        let creator_key = key(1).x_only_public_key().0.serialize();
        // A spent non-minter state cannot authorize a new membership.
        let non_minter = state(&compiled, &creator_key, &key(3).x_only_public_key().0.serialize(), &key(2).x_only_public_key().0.serialize(), EXPIRY, PRICE as i64, false);
        let mut swapped = entries.clone();
        swapped[0] = UtxoEntry::new(DEPOSIT, pay_to_script_hash_script(&non_minter), 1, false, Some(COVENANT_ID));
        assert!(
            execute(&mint_transaction(&compiled, &minter, &member, &swapped, valid_mint_outputs(&minter, &member)), &swapped, 0).is_err(),
            "a non-minter state must not authorize a mint",
        );
    }

    #[test]
    fn mint_rejects_a_member_state_that_outlives_the_contract_lifetime() {
        let (compiled, minter, _member, entries) = mint_fixture();
        let creator_key = key(1).x_only_public_key().0.serialize();
        let platform_key = key(3).x_only_public_key().0.serialize();
        let buyer_key = key(2).x_only_public_key().0.serialize();
        // Expiry beyond DAA + lifetime is not a valid mint window.
        let overlong = state(&compiled, &creator_key, &platform_key, &buyer_key, DAA as i64 + 26_420_000 + 1, PRICE as i64, false);
        assert_eq!(
            execute(&mint_transaction(&compiled, &minter, &overlong, &entries, valid_mint_outputs(&minter, &overlong)), &entries, 0),
            Err(TxScriptError::VerifyError),
        );
    }

    #[test]
    fn standalone_member_state_cannot_be_spent_as_a_mint() {
        // An attacker can build a member-shaped UTXO outside the creator's
        // covenant family. Spending it as if it were a minter must fail, so a
        // forged state cannot mint or transfer membership on chain.
        let creator_key = key(1).x_only_public_key().0.serialize();
        let platform_key = key(3).x_only_public_key().0.serialize();
        let buyer_key = key(2).x_only_public_key().0.serialize();
        let compiled = compile(&creator_key, &platform_key);
        let forged = state(&compiled, &creator_key, &platform_key, &buyer_key, EXPIRY, PRICE as i64, false);
        let entries = vec![
            UtxoEntry::new(DEPOSIT, pay_to_script_hash_script(&forged), 1, false, Some(COVENANT_ID)),
            UtxoEntry::new(1_000_000_000, p2pk(&buyer_key), 1, false, None),
        ];
        let tx = mint_transaction(&compiled, &forged, &forged, &entries, valid_mint_outputs(&forged, &forged));
        assert!(
            execute(&tx, &entries, 0).is_err(),
            "a forged member state must not be spendable as a minter",
        );
    }
}
