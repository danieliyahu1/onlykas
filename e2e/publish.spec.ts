import { expect, test } from "@playwright/test";

test("creator entry point is usable without exposing media", async ({
  page,
}) => {
  await page.goto("/publish");
  await expect(
    page.getByRole("heading", { name: /make one thing worth opening/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with Kasware" }),
  ).toBeEnabled();
  await expect(page.locator("img, video")).toHaveCount(0);
});
