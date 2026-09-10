# Membership Contract

The checked-in artifact is generated with SilverScript `v1.0.0` at commit
`3ed973335b59269293564805cc2c58a14595ec03`.

```powershell
silverc.exe membership.sil --constructor-args membership.args.json `
  -o ..\src\contracts\membership.json
```

The official Windows release archive has SHA-256
`3e0d660c15a9e7ac90f3960da24d348b076b1891481bfe758db18accc8a102e1`.

Run the consensus tests with:

```powershell
cargo test --manifest-path backend/contracts/consensus-tests/Cargo.toml
```
