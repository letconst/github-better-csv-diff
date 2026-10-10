import { expect, filesPath, fixturePage, test } from "./fixtures";

test("toggle flips between the table view and the raw diff", async ({
  page,
  site,
}) => {
  site.pages.set(filesPath, fixturePage("classic-pr-split"));
  await page.goto(filesPath);

  const button = page.locator(".csv-diff-toggle-btn");
  const wrapper = page.locator(".csv-diff-wrapper");
  const rawChild = page
    .locator(".js-file-content > :not(.csv-diff-wrapper)")
    .first();

  await expect(wrapper).toBeVisible();
  await expect(button).toHaveText("Raw Diff");
  await expect(button).toHaveClass(/csv-diff-toggle-active/);

  await button.click();
  await expect(wrapper).toBeHidden();
  await expect(rawChild).not.toHaveCSS("display", "none");
  await expect(button).toHaveText("Table View");
  await expect(button).not.toHaveClass(/csv-diff-toggle-active/);

  await button.click();
  await expect(wrapper).toBeVisible();
  await expect(rawChild).toHaveCSS("display", "none");
  await expect(button).toHaveText("Raw Diff");
  await expect(button).toHaveClass(/csv-diff-toggle-active/);
});
