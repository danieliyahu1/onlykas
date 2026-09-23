/**
 * Classifies a rejected wallet address for logging without ever exposing the
 * address itself. When `/api/auth/challenge` returns `INVALID_REQUEST`, the
 * most useful debugging facts are *why* the value failed and — above all —
 * whether the wallet sent the other network's prefix. This returns those facts
 * as plain data: prefixes and a length bucket, never the address characters.
 */
export type AddressProblem =
  | "missing"
  | "not_string"
  | "wrong_prefix"
  | "bad_shape";

export interface AddressDiagnostic {
  problem: AddressProblem;
  /** The prefix before `:` when the value has one, e.g. `kaspa`. Never the address. */
  prefix?: string;
  /** Coarse payload length bucket, e.g. `61`, so logs stay greppable. */
  lengthBucket?: number;
}

const prefixPattern = /^([a-z]+):/;

export function diagnoseAddress(
  value: unknown,
  expectedPrefix: string,
): AddressDiagnostic {
  if (value === undefined || value === null) return { problem: "missing" };
  if (typeof value !== "string") return { problem: "not_string" };

  const match = prefixPattern.exec(value);
  const prefix = match?.[1];
  const lengthBucket = value.length;
  if (prefix !== expectedPrefix) {
    return {
      problem: "wrong_prefix",
      ...(prefix !== undefined ? { prefix } : {}),
      lengthBucket,
    };
  }
  return { problem: "bad_shape", prefix, lengthBucket };
}
