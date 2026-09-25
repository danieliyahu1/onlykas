import { PUBLIC_PAGES, publicPageByPath } from "./index.js";

function paragraphs(path: string): string {
  const page = publicPageByPath(path);
  if (!page) throw new Error(`missing page ${path}`);
  return page.sections.flatMap((section) => section.paragraphs).join(" ");
}

describe("public pages", () => {
  it("tells readers how to report content", () => {
    const policy = paragraphs("/content-policy");

    expect(policy).toMatch(/report/i);
    expect(policy).toMatch(/feedback button/i);
  });

  it.each(PUBLIC_PAGES)("dates $path", (page) => {
    expect(page.updated).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
  });

  it.each(PUBLIC_PAGES)(
    "does not claim content is stored on the blockchain on $path",
    (page) => {
      for (const section of page.sections) {
        for (const paragraph of section.paragraphs) {
          expect(paragraph).not.toMatch(/withdrawn from the chain/i);
          expect(paragraph).not.toMatch(/permanent on-chain/i);
          expect(paragraph).not.toMatch(/content published on-chain/i);
        }
      }
    },
  );
});
