import { formatKas, formatTime, shortenAddress } from "./format.js";
import { creatorAddressFromRoute, creatorPath } from "./creator-url.js";

describe("formatKas", () => {
  it("renders whole KAS without trailing zeros", () => {
    expect(formatKas("0")).toBe("0");
    expect(formatKas("100000000")).toBe("1");
    expect(formatKas("100000000000")).toBe("1000");
  });

  it("keeps the full eight decimal places when needed", () => {
    expect(formatKas("1")).toBe("0.00000001");
    expect(formatKas("123456789")).toBe("1.23456789");
  });
});

describe("formatTime", () => {
  it("formats whole seconds as minutes and seconds", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(600)).toBe("10:00");
  });

  it("falls back to zero for a duration that is not a number", () => {
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("shortenAddress", () => {
  it("keeps the head and tail of the address", () => {
    const address = `kaspatest:${"q".repeat(60)}`;
    expect(shortenAddress(address)).toBe("kaspatest:qqqqqq...qqqqqqqq");
  });
});

describe("creator URL", () => {
  it("omits the network prefix from creator paths", () => {
    const address = `kaspatest:${"q".repeat(60)}`;

    expect(creatorPath(address)).toBe(`/creator/${"q".repeat(60)}`);
  });

  it("restores the network prefix when reading a short creator path", () => {
    const address = "q".repeat(60);

    expect(creatorAddressFromRoute(address)).toBe(`kaspatest:${address}`);
    expect(creatorAddressFromRoute(`kaspatest:${address}`)).toBe(
      `kaspatest:${address}`,
    );
  });
});
