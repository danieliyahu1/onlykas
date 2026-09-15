import { platformFeeSompi } from "./payment-fee.js";

describe("platform fee", () => {
  it("charges the one percent fee only once it reaches one KAS", () => {
    expect(platformFeeSompi(10_000_000_000n)).toBe(100_000_000n);
    expect(platformFeeSompi(20_000_000_000n)).toBe(200_000_000n);
    expect(platformFeeSompi(9_999_999_950n)).toBe(100_000_000n);
    expect(platformFeeSompi(9_999_999_949n)).toBe(0n);
    expect(platformFeeSompi(100_000_000n)).toBe(0n);
    expect(platformFeeSompi(1_000_000n)).toBe(0n);
    expect(platformFeeSompi(49n)).toBe(0n);
  });
});
