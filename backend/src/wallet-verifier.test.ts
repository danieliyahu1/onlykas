import { KaspaWalletVerifier } from "./wallet-verifier.js";

describe("KaspaWalletVerifier", () => {
  it("accepts the hexadecimal signature returned by Kasware", async () => {
    const message =
      "Sign in to OnlyKas. This does not send KAS.\n\nWallet: kaspatest:qpg2gxu40zmtuwnsgny5mh7d7sq59dzfsnfsn0u5ds79az0tjh2g7f6gwpdn7\nNetwork: kaspa_testnet_10\nOrigin: http://localhost:5173\nNonce: fad328867fc1083d06dd6ad9c0a50a1e4496cb11890bc58a7934b95736e7e9ca";
    const verifier = new KaspaWalletVerifier();

    await expect(
      verifier.verify(
        message,
        "12c6f6c8de8d604054a14c7c0c9c343dc23f026cb39dc558fe1ca5d73371e78ef29fa42cfd5d5975e7250e62e5c9a1e66baa92ebed4a4be61108dcb2cf02de16",
        "0250a41b9578b6be3a7044c94ddfcdf40142b44984d309bf946c3c5e89eb95d48f",
        "kaspatest:qpg2gxu40zmtuwnsgny5mh7d7sq59dzfsnfsn0u5ds79az0tjh2g7f6gwpdn7",
      ),
    ).resolves.toBe(true);
  });
});
