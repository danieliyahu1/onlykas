import { PublicKey, verifyMessage } from "kaspa-wasm";
import { DEFAULT_NETWORK, type NetworkId } from "@onlykas/shared";
import type { WalletVerifier } from "./application/ports.js";

export class KaspaWalletVerifier implements WalletVerifier {
  constructor(private readonly network: NetworkId = DEFAULT_NETWORK) {}

  async verify(
    message: string,
    signature: string,
    publicKeyValue: string,
    address: string,
  ): Promise<boolean> {
    try {
      const publicKey = new PublicKey(publicKeyValue);
      const derivedAddresses = [publicKey.toAddress(this.network).toString()];
      try {
        derivedAddresses.push(
          publicKey.toAddressECDSA(this.network).toString(),
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
