import { parseEnvironment } from "./config.js";

const testnetFee =
  "kaspatest:qpd82aj5unvrcj59ygscnmv9g0lryl3j5lp0dqquufqae382lh7lyxkh30lue";
const mainnetFee =
  "kaspa:qpd82aj5unvrcj59ygscnmv9g0lryl3j5lp0dqquufqae382lh7lyxkh30lue";

const valid = {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: "http://localhost:5173",
  DATABASE_URL: "file:test.db",
  R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  R2_BUCKET: "test",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  PLATFORM_FEE_ADDRESS_TESTNET_10: testnetFee,
  PLATFORM_FEE_ADDRESS_MAINNET: mainnetFee,
};

describe("environment", () => {
  it("parses a complete environment and selects the testnet fee wallet", () => {
    expect(parseEnvironment(valid)).toMatchObject({
      PORT: 3000,
      METRICS_PORT: 9090,
      GIT_REVISION: "unknown",
      R2_REGION: "auto",
      KASPA_NETWORK: "testnet-10",
      KASPA_NODE_URL: "https://api-tn10.kaspa.org",
      PLATFORM_FEE_ADDRESS: testnetFee,
    });
  });

  it("derives the node URL and selects the mainnet fee wallet", () => {
    expect(
      parseEnvironment({
        ...valid,
        KASPA_NETWORK: "mainnet",
        KASPA_NODE_URL: undefined,
      }),
    ).toMatchObject({
      KASPA_NETWORK: "mainnet",
      KASPA_NODE_URL: "https://api.kaspa.org",
      PLATFORM_FEE_ADDRESS: mainnetFee,
    });
  });

  it("switches the fee wallet when only KASPA_NETWORK changes", () => {
    const shared = {
      ...valid,
      PLATFORM_FEE_ADDRESS_MAINNET: mainnetFee,
      PLATFORM_FEE_ADDRESS_TESTNET_10: testnetFee,
    };
    expect(parseEnvironment(shared).PLATFORM_FEE_ADDRESS).toBe(testnetFee);
    expect(
      parseEnvironment({ ...shared, KASPA_NETWORK: "mainnet" })
        .PLATFORM_FEE_ADDRESS,
    ).toBe(mainnetFee);
  });

  it("requires the fee wallet of the selected network", () => {
    expect(() =>
      parseEnvironment({
        ...valid,
        PLATFORM_FEE_ADDRESS_TESTNET_10: undefined,
      }),
    ).toThrow();
    expect(() =>
      parseEnvironment({
        ...valid,
        KASPA_NETWORK: "mainnet",
        PLATFORM_FEE_ADDRESS_MAINNET: undefined,
      }),
    ).toThrow();
  });

  it("rejects a selected fee wallet that belongs to the other network", () => {
    expect(() =>
      parseEnvironment({
        ...valid,
        KASPA_NETWORK: "mainnet",
        PLATFORM_FEE_ADDRESS_MAINNET: testnetFee,
      }),
    ).toThrow();
  });

  it("ignores a malformed wallet for the unused network", () => {
    expect(
      parseEnvironment({
        ...valid,
        PLATFORM_FEE_ADDRESS_MAINNET: "kaspa:not-an-address",
      }).PLATFORM_FEE_ADDRESS,
    ).toBe(testnetFee);
  });

  it("rejects an invalid metrics port", () => {
    expect(() => parseEnvironment({ ...valid, METRICS_PORT: "0" })).toThrow();
  });

  it("rejects missing private storage", () => {
    expect(() => parseEnvironment({ ...valid, R2_BUCKET: "" })).toThrow();
  });

  it("rejects an invalid fee wallet", () => {
    expect(() =>
      parseEnvironment({
        ...valid,
        PLATFORM_FEE_ADDRESS_TESTNET_10: "kaspatest:not-an-address",
      }),
    ).toThrow();
  });
});
