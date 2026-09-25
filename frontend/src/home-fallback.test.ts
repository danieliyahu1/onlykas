import * as homeCopy from "./home-copy.json";
import { homeFallbackHtml } from "../home-fallback.js";

describe("homeFallbackHtml", () => {
  it("carries the fee and payment facts a JavaScript-free crawler needs", () => {
    const html = homeFallbackHtml(homeCopy);

    expect(html).toContain("OnlyKas takes 1%");
    expect(html).toContain("Powered by Kaspa");
  });

  it("carries the subscription facts", () => {
    const html = homeFallbackHtml(homeCopy);

    expect(html).toContain("subscribe for 30 days");
    expect(html).toContain("KAS");
  });

  it("mirrors the copy rendered on the page", () => {
    const html = homeFallbackHtml(homeCopy);

    expect(html).toContain(homeCopy.headline);
    expect(html).toContain(homeCopy.lede);
    expect(html).toContain(homeCopy.moneyHeading);
    expect(html).toContain(homeCopy.fanHeading);
  });

  it("escapes copy so the shell stays valid HTML", () => {
    const html = homeFallbackHtml({ ...homeCopy, headline: "<script>" });

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
