import { expect, test } from "@playwright/test";

test("creator entry point becomes ready after choosing media", async ({
  page,
}) => {
  await page.goto("/publish");
  await expect(
    page.getByRole("heading", { name: /share something special/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^publish/i })).toBeDisabled();
  await expect(
    page.locator(".media-stage img, .media-stage video"),
  ).toHaveCount(0);

  await page.getByLabel(/choose image or video/i).setInputFiles({
    name: "moment.png",
    mimeType: "image/png",
    buffer: Buffer.from("preview"),
  });

  await expect(
    page.getByRole("img", { name: /selected image preview/i }),
  ).toBeVisible();
  await expect(page.getByLabel("Captions")).toHaveValue(
    "Shared just for supporters.",
  );
  await expect(page.getByLabel("Price")).toHaveValue("1");
  await expect(page.getByRole("button", { name: /^publish/i })).toBeEnabled();
});
