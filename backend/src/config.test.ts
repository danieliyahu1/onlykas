import { parseEnvironment } from "./config.js";

const valid = {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: "http://localhost:5173",
  DATABASE_URL: "file:test.db",
  R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  R2_BUCKET: "test",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  PLATFORM_FEE_ADDRESS: "kaspatest:qpd82aj5unvrcj59ygscnmv9g0lryl3j5lp0dqquufqae382lh7lyxkh30lue",
};

describe("environment", () => {
  it("parses a complete testnet-only environment", () => {
    expect(parseEnvironment(valid)).toMatchObject({
      PORT: 3000,
      METRICS_PORT: 9090,
      GIT_REVISION: "unknown",
      R2_REGION: "auto",
      KASPA_NETWORK: "testnet-10",
      KASPA_NODE_URL: "https://api-tn10.kaspa.org",
    });
  });

  it("derives the node URL and accepts a matching fee address for mainnet", () => {
    expect(
      parseEnvironment({
        ...valid,
        KASPA_NETWORK: "mainnet",
        KASPA_NODE_URL: undefined,
        PLATFORM_FEE_ADDRESS:
          "kaspa:qpd82aj5unvrcj59ygscnmv9g0lryl3j5lp0dqquufqae382lh7lyxkh30lue",
      }),
    ).toMatchObject({
      KASPA_NETWORK: "mainnet",
      KASPA_NODE_URL: "https://api.kaspa.org",
    });
  });

  it("rejects a fee address that does not belong to the selected network", () => {
    expect(() =>
      parseEnvironment({ ...valid, KASPA_NETWORK: "mainnet" }),
    ).toThrow();
  });

  it("rejects an invalid metrics port", () => {
    expect(() => parseEnvironment({ ...valid, METRICS_PORT: "0" })).toThrow();
  });

  it("rejects missing private storage", () => {
    expect(() => parseEnvironment({ ...valid, R2_BUCKET: "" })).toThrow();
  });

  it("rejects an invalid fee wallet", () => {
    expect(() => parseEnvironment({ ...valid, PLATFORM_FEE_ADDRESS: "kaspatest:not-an-address" })).toThrow();
  });
});
