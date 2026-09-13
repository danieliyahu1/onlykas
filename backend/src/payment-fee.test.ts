import { platformFeeSompi } from "./payment-fee.js";

describe("platform fee", () => {
  it("rounds the one percent fee to the nearest sompi", () => {
    expect(platformFeeSompi(100_000_000n)).toBe(1_000_000n);
    expect(platformFeeSompi(149n)).toBe(1n);
    expect(platformFeeSompi(50n)).toBe(1n);
    expect(platformFeeSompi(49n)).toBe(0n);
  });
});
