import { Keypair, signMessage } from "kaspa-wasm";
import { DEFAULT_NETWORK } from "@kaskama/shared";
import { KaspaWalletVerifier } from "./wallet-verifier.js";

describe("KaspaWalletVerifier", () => {
  it("accepts the hexadecimal signature returned by Kasware", async () => {
    const keypair = Keypair.random();
    const address = keypair.toAddress(DEFAULT_NETWORK).toString();
    const message = `Sign in to Kaskama. This does not send KAS.\n\nWallet: ${address}\nNetwork: kaspa_testnet_10\nOrigin: http://localhost:5173\nNonce: fad328867fc1083d06dd6ad9c0a50a1e4496cb11890bc58a7934b95736e7e9ca`;
    const signature = signMessage({ message, privateKey: keypair.privateKey });
    const verifier = new KaspaWalletVerifier();

    await expect(
      verifier.verify(message, signature, keypair.publicKey.toString(), address),
    ).resolves.toBe(true);
  });
});
