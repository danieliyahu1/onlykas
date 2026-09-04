# On-chain membership verification

OnlyKas memberships live on the Kaspa chain as KCC-0020 covenant UTXOs. This
document describes how the covenant-id convention (OQ-4) works and how the
verifier builds an independent, public status from chain data alone — no
OnlyKas records are consulted.

## OQ-4 covenant-id convention

A membership covenant is identified by the prefix `covenant-` followed by the
first 16 hex characters of the SHA-256 of its canonical template JSON:

```
covenant-id = "covenant-" + sha256(templateJson).slice(0, 16)
```

- The canonical template is produced by `buildMembershipCovenantTemplate()`
  in `backend/src/covenant.ts` (type `KCC-0020`, `version: 1`, `amount: 1`,
  `creatorRoyaltyBps`, `durationMs`, and the `mint`/`transfer` field sets).
- `canonicalMembershipCovenantId()` returns the id for the unchanged
  template; `membershipCovenantId(templateJson)` computes it for any template.
- A deploy covenant is recognized when its payload is
  `DEPLOY_COVENANT` with a `template` whose fingerprint matches its
  `templateFingerprint` field. The verifier then reports
  `covenantId: membershipCovenantId(deploy.template)` and
  `status: NOT_MEMBERSHIP` with `kind: "deploy"` — a deployed (non-canonical)
  template is therefore never treated as a membership.

## Token recognition rules

A membership token is recognized only when all of the following hold; anything
else is `NOT_MEMBERSHIP`:

- covenant `type` is `KCC-0020`;
- payload `type` is `MINT` or `TRANSFER`;
- payload `owner` is a non-empty string;
- payload `created_at` and `valid_until` are finite numeric values
  (milliseconds, as numbers or numeric strings);
- `valid_until - created_at === MEMBERSHIP_DURATION_MS` (24 h).

The owner, `offerId`, `creator`, and `membershipId` (for transfers) are read
from the payload. The payload may be an object or a JSON string; both are
accepted.

## Status semantics

Each checked UTXO yields one `MembershipCheck` with a status:

| Status           | Meaning                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| `VALID`          | token recognized, `expectedOwner` matches (if given), and `valid_until > now` |
| `EXPIRED`        | token recognized but `valid_until <= now`                                     |
| `OWNER_MISMATCH` | token recognized and unexpired, but `owner !== expectedOwner`                 |
| `NOT_MEMBERSHIP` | covenant is missing, not `KCC-0020`, or fails recognition                     |

Precedence: `OWNER_MISMATCH` is reported before `EXPIRED` when both apply. An
address scan is `valid` when at least one scanned UTXO is `VALID`.

## Source of truth

The verifier reads only Kaspa chain data:

- address scan — `GET /addresses/{address}/utxos`;
- covenant lookup — prefer `utxoEntry.covenant` when present, otherwise the
  UTXO's creation transaction `GET /transactions/{transactionId}` and its
  `outputs[outputIndex].covenant`;
- `now` is captured per request (default `Date.now`).

## HTTP API

Both endpoints are public and unauthenticated.

### Address scan

```
GET /api/verify/membership/address/:address[?owner=<kaspatest:...>]
```

`owner` (optional) asserts membership belongs to a specific address.

```json
{
  "address": "kaspatest:qqqq...",
  "verifiedAt": "2026-09-04T00:00:00.000Z",
  "valid": true,
  "memberships": [
    {
      "transactionId": "0f3c...",
      "outputIndex": 0,
      "covenantId": "covenant-a1b2c3d4e5f60718",
      "kind": "token",
      "tokenType": "MINT",
      "owner": "kaspatest:qqqq...",
      "createdAt": "2026-09-03T00:00:00.000Z",
      "validUntil": "2026-09-04T00:00:00.000Z",
      "status": "VALID"
    }
  ]
}
```

### Single UTXO

```
GET /api/verify/membership/utxo/:transactionId/:outputIndex[?owner=<kaspatest:...>]
```

Returns a single `MembershipCheck`. `transactionId` must be 64 hex
characters and `outputIndex` a non-negative integer.

Errors: `400 INVALID_ADDRESS` / `400 INVALID_REQUEST` for bad parameters,
`503 VERIFY_UNAVAILABLE` when the server has no verifier wired.

## CLI

```
pnpm --filter backend verify:membership address <kaspatest:address> [--owner <address>] [--node <url>]
pnpm --filter backend verify:membership utxo <transactionId> <outputIndex> [--owner <address>] [--node <url>]
```

Runs `runVerifierCli` (`backend/src/verifier-cli.ts`) against the default
testnet node (`https://api-tn10.kaspa.org`) unless `--node` overrides it, and
prints the same JSON shapes described above.

## Server wiring

`backend/src/server.ts` constructs
`new KaspaMembershipVerifier(environment.KASPA_NODE_URL)` and injects it as
`membershipVerifier` into `createApp`. The verifier is independent of the
covenant gateway used for minting and transfers; it is safe for public use.
