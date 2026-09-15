export const PLATFORM_FEE_BPS = 100n;
export const BPS_DENOMINATOR = 10_000n;
export const MIN_PLATFORM_FEE_SOMPI = 100_000_000n;

export function platformFeeSompi(amountSompi: bigint): bigint {
  if (amountSompi < 0n) throw new Error("INVALID_PAYMENT_AMOUNT");
  const fee = (amountSompi * PLATFORM_FEE_BPS + BPS_DENOMINATOR / 2n) / BPS_DENOMINATOR;
  return fee >= MIN_PLATFORM_FEE_SOMPI ? fee : 0n;
}
