import { expect, test } from "@playwright/test";

test("the promise and the action are in the first screen", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  const heading = page.getByRole("heading", {
    name: "Get paid by the people who love your work.",
  });
  const action = page.getByRole("link", { name: "Start publishing" });

  await expect(heading).toBeVisible();
  await expect(action).toBeVisible();
  await expect(heading).toBeInViewport();
  await expect(action).toBeInViewport();

  const { documentHeight, viewportHeight } = await page.evaluate(() => ({
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }));

  expect(documentHeight).toBeLessThanOrEqual(viewportHeight + 1);
});

test("the preview is below the first screen and reachable", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  const preview = page.getByRole("img", { name: /subscribed fan's view/i });
  await expect(preview).toBeAttached();

  await preview.scrollIntoViewIfNeeded();

  await expect(preview).toBeInViewport();
});

test("the homepage scrolls instead of cramming the first screen", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "desktop layout check");

  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  const mainScrolls = await page.evaluate(() => {
    const main = document.querySelector("main");
    return (main?.scrollHeight ?? 0) > (main?.clientHeight ?? 0);
  });

  expect(mainScrolls).toBe(true);
});
