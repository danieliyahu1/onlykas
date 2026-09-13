export const PLATFORM_FEE_BPS = 100n;
export const BPS_DENOMINATOR = 10_000n;

export function platformFeeSompi(amountSompi: bigint): bigint {
  if (amountSompi < 0n) throw new Error("INVALID_PAYMENT_AMOUNT");
  return (amountSompi * PLATFORM_FEE_BPS + BPS_DENOMINATOR / 2n) / BPS_DENOMINATOR;
}
