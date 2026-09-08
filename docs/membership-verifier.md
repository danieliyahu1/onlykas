# On-chain membership verification

OnlyKas memberships are SilverScript covenant UTXOs on Kaspa testnet-10. The
verifier determines membership from chain data alone. Database membership rows
and descriptive transaction fields are not authorization sources.

## Discovery

Mint transactions create a 1,000-sompi P2PK output for the member. This output
is a discovery pointer, not the membership token itself.

For each unspent output returned by `GET /addresses/{member}/utxos`, the
verifier loads its creation transaction and requires the pointer output to:

- contain exactly 1,000 sompi;
- use the scanned member address's P2PK script;
- share a transaction with a valid membership covenant output.

The returned `MembershipCheck.outputIndex` identifies the covenant output, not
the discovery output.

## Covenant validation

A membership is recognized only when all of these checks pass:

- the transaction has version `1`;
- its hex payload decodes to JSON with protocol `onlykas-membership-v1`;
- the payload reveals `memberRedeemScript`;
- the redeem script matches the compiled SilverScript template and decodes to
  non-minter state;
- hashing that redeem script produces the covenant output's P2SH script;
- the output contains exactly 10,000,000 sompi;
- the output has a consensus covenant ID, matching `expectedCovenantId` when
  one is supplied;
- the output is authorized by covenant input `0`;
- the owner public key in covenant state derives the reported testnet-10
  address;
- the creator public key in state matches the creator whose offer is checked;
- the transaction pays exactly 1 KAS to that creator and creates the member's
  1,000-sompi discovery pointer;
- the covenant output still appears in the UTXO set for its P2SH address.

The last check prevents a spent token from remaining valid when an unrelated
discovery output still exists.

## Status semantics

The verifier reads `virtualDaaScore` from `GET /info/blockdag` and compares it
with the expiry committed in covenant state.

| Status | Meaning |
| --- | --- |
| `VALID` | The covenant is recognized, unspent, owned by the expected address when supplied, and its expiry DAA is in the future. |
| `EXPIRED` | The covenant is recognized and unspent, but current DAA is at or beyond its expiry. |
| `OWNER_MISMATCH` | The covenant is recognized and unspent, but its state owner differs from `expectedOwner`. |
| `NOT_MEMBERSHIP` | Any discovery, template, script, amount, covenant ID, lifetime, or unspent check fails. |

`createdAt` and `validUntil` remain ISO strings for the existing API. They are
display estimates derived from the committed expiry, fixed 864,000-DAA
membership duration, current wall clock, and current DAA difference;
authorization uses DAA values only.

## HTTP API

Both endpoints are public and unauthenticated.

```text
GET /api/verify/membership/address/:address[?owner=<kaspatest:...>]
GET /api/verify/membership/utxo/:transactionId/:outputIndex[?owner=<kaspatest:...>]
```

The address endpoint returns every checked pointer candidate and sets `valid`
when at least one result is `VALID`. The UTXO endpoint checks the specified
covenant output directly.

Errors are `400 INVALID_ADDRESS`, `400 INVALID_REQUEST`, or
`503 VERIFY_UNAVAILABLE` when no verifier is configured.

## CLI

```text
pnpm --filter @onlykas/backend verify:membership address <kaspatest:address> [--owner <address>] [--node <url>]
pnpm --filter @onlykas/backend verify:membership utxo <transactionId> <outputIndex> [--owner <address>] [--node <url>]
```

The default node is `https://api-tn10.kaspa.org`. `backend/src/server.ts`
constructs `KaspaMembershipVerifier` using `KASPA_NODE_URL` and injects it into
the application.
