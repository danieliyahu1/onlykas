import { parseEnvironment } from "./config.js";

const valid = {
  NODE_ENV: "test",
  PUBLIC_ORIGIN: "http://localhost:5173",
  DATABASE_URL: "file:test.db",
  R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
  R2_BUCKET: "test",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
};

describe("environment", () => {
  it("parses a complete testnet-only environment", () => {
    expect(parseEnvironment(valid)).toMatchObject({
      PORT: 3000,
      R2_REGION: "auto",
    });
  });

  it("rejects missing private storage", () => {
    expect(() => parseEnvironment({ ...valid, R2_BUCKET: "" })).toThrow();
  });
});
