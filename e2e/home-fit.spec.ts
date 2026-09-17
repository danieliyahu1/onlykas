import { expect, test } from "@playwright/test";

test("home page fits the viewport without scrolling", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Get paid by the people who love your work.",
    }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const { documentHeight, viewportHeight, mainHeight, mainVisibleHeight } =
    await page.evaluate(() => {
      const main = document.querySelector("main");
      return {
        documentHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        mainHeight: main?.scrollHeight ?? 0,
        mainVisibleHeight: main?.clientHeight ?? 0,
      };
    });

  expect(documentHeight).toBeLessThanOrEqual(viewportHeight + 1);
  expect(mainHeight).toBeLessThanOrEqual(mainVisibleHeight + 1);
});
