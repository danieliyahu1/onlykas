import { KASPA_TESTNET_ADDRESS_PATTERN } from "@onlykas/shared";

export type KaspaAddress = string & { readonly __kaspaAddress: unique symbol };
export type Sompi = bigint & { readonly __sompi: unique symbol };
export type TransactionId = string & { readonly __transactionId: unique symbol };
export type CovenantId = string & { readonly __covenantId: unique symbol };
export type MediaDigest = string & { readonly __mediaDigest: unique symbol };

export function kaspaAddress(value: string): KaspaAddress {
  if (!KASPA_TESTNET_ADDRESS_PATTERN.test(value)) {
    throw new Error("INVALID_KASPA_ADDRESS");
  }
  return value as KaspaAddress;
}

export function sompi(value: string | bigint): Sompi {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  if (amount <= 0n) throw new Error("INVALID_SOMPI");
  return amount as Sompi;
}

export function transactionId(value: string): TransactionId {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("INVALID_TRANSACTION_ID");
  return value as TransactionId;
}

export function covenantId(value: string): CovenantId {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("INVALID_COVENANT_ID");
  return value as CovenantId;
}

export function mediaDigest(value: string): MediaDigest {
  if (!/^[0-9a-f]{64}$/i.test(value)) throw new Error("INVALID_MEDIA_DIGEST");
  return value as MediaDigest;
}
