import {
  commitPath,
  documentWith,
  expect,
  filesPath,
  fixtureHtml,
  fixturePage,
  test,
} from "./fixtures";

test("Classic UI: injects the toggle, hides the raw diff and applies extension CSS", async ({
  page,
  site,
}) => {
  site.pages.set(filesPath, fixturePage("classic-pr-split"));
  await page.goto(filesPath);

  await expect(page.locator(".file-actions .csv-diff-toggle-btn")).toHaveCount(
    1,
  );
  await expect(page.locator(".csv-diff-wrapper")).toHaveCount(1);
  await expect(page.locator(".csv-diff-side")).toHaveCount(2);
  await expect(page.locator(".csv-diff-container")).toHaveCSS(
    "display",
    "flex",
  );

  const rawDisplays = await page
    .locator(".js-file-content > :not(.csv-diff-wrapper)")
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.display));
  expect(rawDisplays.length).toBeGreaterThan(0);
  expect(rawDisplays.every((d) => d === "none")).toBe(true);
});

test("Preview UI commit page: injects the toggle, hides the raw diff and applies extension CSS", async ({
  page,
  site,
}) => {
  site.pages.set(commitPath, fixturePage("preview-commit-split"));
  await page.goto(commitPath);

  await expect(
    page.locator('div[class*="diffHeaderWrapper"] .csv-diff-toggle-btn'),
  ).toHaveCount(1);
  await expect(page.locator(".csv-diff-wrapper")).toHaveCount(1);
  await expect(page.locator(".csv-diff-side")).toHaveCount(2);
  await expect(page.locator(".csv-diff-container")).toHaveCSS(
    "display",
    "flex",
  );

  const rawDisplays = await page
    .locator('div[role="region"] > :nth-child(2) > :not(.csv-diff-wrapper)')
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.display));
  expect(rawDisplays.length).toBeGreaterThan(0);
  expect(rawDisplays.every((d) => d === "none")).toBe(true);
});

test("leaves non-CSV files untouched and processes an uppercase .TSV extension", async ({
  page,
  site,
}) => {
  const container = fixtureHtml("classic-pr-split");
  const withPath = (filePath: string) =>
    container.replace(
      'data-tagsearch-path="example/sample.csv"',
      `data-tagsearch-path="${filePath}"`,
    );
  site.pages.set(
    filesPath,
    documentWith(withPath("README.md") + withPath("example/DATA.TSV")),
  );
  await page.goto(filesPath);

  await expect(page.locator(".csv-diff-wrapper")).toHaveCount(1);
  await expect(
    page.locator('[data-tagsearch-path="example/DATA.TSV"] .csv-diff-wrapper'),
  ).toHaveCount(1);
  await expect(
    page.locator('[data-tagsearch-path="README.md"] .csv-diff-toggle-btn'),
  ).toHaveCount(0);
  await expect(
    page
      .locator('[data-tagsearch-path="README.md"] .js-file-content > *')
      .first(),
  ).not.toHaveCSS("display", "none");
});
