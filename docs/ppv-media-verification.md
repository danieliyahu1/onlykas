# On-chain PPV media verification

Pay-per-view purchases embed a self-describing media commitment in the Kaspa
transaction payload. Any platform that holds the original media bytes can
recompute the commitment and prove that a purchase paid for exactly those
bytes, without trusting OnlyKas.

## Wire format

The transaction `payload` field is hex-encoded UTF-8 JSON. New purchases use
this version 1 shape:

```json
{
  "protocol": "onlykas",
  "version": 1,
  "type": "post-purchase",
  "postId": "<post id>",
  "mediaHash": {
    "algorithm": "blake3-256",
    "encoding": "hex",
    "digest": "<64 lowercase hex characters>"
  }
}
```

- `algorithm` names the hash function applied to the media bytes.
- `encoding` names how the resulting bytes are written as text.
- `digest` is the hash of the exact media bytes that OnlyKas validated and
  stored, encoded as `encoding` specifies.

`blake3-256` always produces 32 bytes, so a `hex` digest is always 64
characters.

## Verifying the media

1. Load the purchase transaction and hex-decode `payload`.
2. Parse the JSON and read `mediaHash`.
3. Hash the original media bytes with the named `algorithm`.
4. Encode the raw hash using the named `encoding`.
5. The encoded value must equal `digest`, character for character.

The digest covers the media file content only, not its filename, post caption,
or price. Two files with identical bytes always produce the same digest.

## Legacy payloads

Version 1 payloads published before the self-describing hash stored a bare
string:

```json
{
  "protocol": "onlykas",
  "version": 1,
  "type": "post-purchase",
  "postId": "<post id>",
  "mediaDigest": "<64 lowercase hex characters>"
}
```

A `mediaDigest` is always BLAKE3-256 encoded as lowercase hex. Treat it as
`{ "algorithm": "blake3-256", "encoding": "hex", "digest": mediaDigest }`.

## Payment checks

The media commitment is necessary but not sufficient. A purchase is honored
only when the transaction also:

- has at least one input resolved to the buyer address;
- pays `price - fee` sompi to the creator address;
- pays the platform fee to the configured platform address when the fee is
  non-zero, and pays the platform nothing when it is zero.

OnlyKas verifies the payload when returning purchased media, so a client
tampering with the stored receipt does not unlock a post.
