import { PublicKey, verifyMessage } from "kaspa-wasm";
import type { WalletVerifier } from "./domain.js";

export class KaspaWalletVerifier implements WalletVerifier {
  async verify(
    message: string,
    signature: string,
    publicKeyValue: string,
    address: string,
  ): Promise<boolean> {
    try {
      const publicKey = new PublicKey(publicKeyValue);
      const derivedAddresses = [publicKey.toAddress("testnet-10").toString()];
      try {
        derivedAddresses.push(
          publicKey.toAddressECDSA("testnet-10").toString(),
        );
      } catch {
        // Some Kasware public keys do not support ECDSA address derivation.
      }
      const ownsAddress = derivedAddresses.includes(address);
      if (!ownsAddress) return false;
      const hexSignature = /^[0-9a-f]+$/i.test(signature)
        ? signature
        : Buffer.from(signature, "base64").toString("hex");
      return verifyMessage({ message, signature: hexSignature, publicKey });
    } catch {
      return false;
    }
  }
}
