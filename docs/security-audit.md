# Security audit: membership covenant, verifier, and payment trust model

Scope: the Kaspa side of OnlyKas — the SilverScript membership covenant, the
on-chain verifier, the payment and membership gateways, the HTTP authorization
paths that consume them, and the workflow persistence that records outcomes.

Trust model in one sentence: **the client signs a transaction; the backend
decides.** A wallet address, transaction id, covenant id, or any other value
from the browser is only a lookup hint. Authorization is always derived from
canonical chain data by server code.

This document records findings, their status, and the evidence behind the
remaining confidence boundary. It is a self-assessment by the project, not an
independent third-party audit.

## Assets and worst-case outcomes

- Creator revenue: PPV unlock payments and membership mint payments.
- Buyer access: paid media and membership content.
- Platform revenue: the 1% fee, waived below the fee floor.
- Media confidentiality: private R2 objects behind authorization.

Worst-case outcomes: a user gains paid access without paying; a creator is paid
less than the advertised price; a payment is lost while access is not granted;
a covenant authorized by a forged state.

## Findings

### F1 — Legacy confirmation endpoint allowed a client-chosen covenant family

Status: **fixed** (commit "refactor: remove the client-authoritative membership
confirmation endpoint").

The removed `POST /api/membership/purchases/confirm` accepted a `covenantId`
and `transactionId` from the client and persisted a receipt when the UTXO looked
like a member covenant. It did not prove the covenant belonged to the creator's
registered family nor that the creator had been paid.

Active paths now require server-owned preparation:

- `POST /api/membership/:creator/prepare` loads the creator covenant from the
  store and builds the mint transaction server-side.
- `POST /api/membership/purchases/:id/finalize` compares the signed transaction
  against the stored template and verifies the resulting member output against
  the prepared covenant, buyer, and creator.

Evidence: `backend/src/app.ts` (prepare/finalize routes),
`backend/src/membership-gateway.ts` (`prepareMint`, `submit`, `sameTransaction`).

### F2 — Contract enforces payment, ownership, lifetime, and minter provenance

Status: **verified** by adversarial consensus tests.

`backend/contracts/membership.sil` requires a minter state to mint, enforces the
creator payment and optional platform payment, binds the member output to the
buyer's P2PK lock and the discovery pointer, and constrains the membership
lifetime relative to the transaction DAA score.

The consensus suite (`backend/contracts/consensus-tests/src/lib.rs`) exercises
the VM with negative cases added in this audit:

- `mint_rejects_underpayment_to_the_creator`
- `mint_rejects_payment_sent_to_the_wrong_key`
- `mint_rejects_an_output_that_is_not_the_member_output`
- `mint_rejects_when_the_state_is_not_a_minter`
- `mint_rejects_a_member_state_that_outlives_the_contract_lifetime`
- `standalone_member_state_cannot_be_spent_as_a_mint`

The positive mint/update/cancel paths remain covered.

### F3 — Verifier accepts the state the contract defines, not an arbitrary UTXO

Status: **accepted with a documented residual boundary**.

`backend/src/verifier.ts` requires an accepted version-1 transaction, the
expected covenant id when supplied, a non-minter member state, the contractual
member script, `authorizingInput === 0`, matching owner and creator keys, an
unspent covenant output, and an unexpired DAA window. The verifier intentionally
trusts the contract to have enforced payment: if the member output is spendable,
the covenant that produced it required the payment.

The residual boundary: the verifier does not itself re-prove that the covenant
family originated from the creator's minter. That provenance is established by
the server-owned prepare path (F1) and by the covenant VM rules (F2). A future
change that reintroduces a client-supplied covenant id, or that accepts a
receipt for an unknown family, would reopen F1.

### F4 — Prepared templates are fingerprinted and compared

Status: **verified**.

`PaymentGateway.submit` and `MembershipGateway.submit` reject a signed
transaction whose template digest changed, whose non-signature fields differ,
or whose required inputs are unsigned. The buyer, creator, amount, covenant id,
and member output index are taken from the stored prepared record, never from the
request body.

Evidence: `backend/src/payment-gateway.ts`, `backend/src/membership-gateway.ts`.

### F5 — Delayed transactions are now reconciled to completion

Status: **fixed** (this change).

Previously, a membership relay error or confirmation timeout was converted into
a state-changed error and the prepared state was deleted, so a transaction that
later confirmed could pay without the off-chain record reflecting it. The PPV
path persisted a pending workflow but nothing finalized it without another client
request. The frontend did not re-call `finalize`.

A background `WorkflowReconciler` now polls every persisted, unresolved
transaction id, observes chain acceptance through the gateway or verifier, and
writes the terminal off-chain record itself. It never broadcasts a transaction
and never consumes a client-supplied value. Terminal claiming is atomic, so with
multiple replicas exactly one finalizes a workflow. Workflows that never reach
the chain are abandoned after a stale window so a real rejection cannot hide
behind an infinite pending state.

Evidence: `backend/src/application/reconcile-workflows.ts`,
`backend/src/server.ts`, `backend/src/libsql-store.ts`,
`backend/src/application/reconcile-workflows.test.ts`.

### F6 — PPV chain verification accepts an absent payload

Status: **open, low reachability**.

`verifyPurchase` checks the post id and media digest only when `tx.payload` is
truthy. A transaction without a payload can therefore verify for another post
with the same buyer, creator, amount, and fee structure. The normal
prepare/finalize path always embeds and compares the payload, and there is no
client route that creates a receipt for a payloadless transaction, so this is not
reachable through the current API. It should still be tightened.

Recommended: require the payload to parse and match unconditionally.

### F7 — Runtime contract bytecode is not reproducibly tied to source

Status: **open**.

The runtime imports checked-in bytecode from `backend/src/contracts/membership.json`,
while consensus tests compile `membership.sil` independently. CI runs the tests
but does not regenerate the artifact and compare. A build-pipeline step should
regenerate the artifact from pinned tooling and fail on any diff.

### F8 — Network identity was hard-coded to testnet

Status: **in progress** (this change set).

Network selection is now server configuration (`KASPA_NETWORK`), and address
validation, wallet verification, contract address derivation, REST defaults, and
wRPC submission derive from one network definition. Deployment manifests and a
mainnet release gate remain to be finalized before mainnet.

## Residual risks requiring attention before mainnet

1. F6 payload-absent verification.
2. F7 bytecode reproducibility.
3. No independent third-party review of the covenant and payment flows.
4. Abuse controls and dependency timeouts on expensive endpoints.
5. Backup/restore, migration serialization, alerting, and a real-dependency
   integration gate.

## Verification performed

- Unit and integration tests: `pnpm test:unit` (all backend, frontend, shared).
- Contract consensus tests: `pnpm test:contract` — 9 passed, including the six
  adversarial cases above.
- Reconciliation tests: confirm, retry, stale-abandon, reject, membership
  receipt, and single-writer claiming.
- Static type checking: `pnpm typecheck`.
