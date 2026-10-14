import fs from "node:fs";
import path from "node:path";
import {
  documentWith,
  expect,
  filesPath,
  fixtureHtml,
  hold,
  openFixture,
  type Site,
  test,
} from "./fixtures";

const headSha = "944014c7cdd80d4e03818f8185c1c4e82fa464da";
const rawPath = `/letconst/github-better-csv-diff/raw/${headSha}/example/large-file.csv`;
const headerLine =
  "record_id,city,country,population,area_km2,timezone,founded_year\n";
const fullFile = fs.readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "test",
    "fixtures",
    "csv",
    "large-file-cut.after.csv",
  ),
  "utf8",
);

const partialComparisonUrl = `/letconst/github-better-csv-diff/pull/2/show_partial_comparison?base_commit_oid=96e7fb85721f6b5ca4a0752cfd4512076f5bd223&end_commit_oid=${headSha}&partial=pull_requests%2Fstale_comparison&start_commit_oid=96e7fb85721f6b5ca4a0752cfd4512076f5bd223`;

const cutPage = documentWith(
  `<div data-url="${partialComparisonUrl}"></div>${fixtureHtml("classic-pr-split-large-file-cut")}`,
);

const side = (which: "first-child" | "last-child") =>
  `.csv-diff-side:${which} .csv-diff-body-table`;
const beforeBody = side("first-child");
const afterBody = side("last-child");
const loadingCells = `${afterBody} td.csv-diff-loading`;

function serveHeader(site: Site) {
  site.raw.set(rawPath, { status: 206, body: headerLine });
}

test("shows a loading cell for the cut rows until the full file arrives, then the complete record", async ({
  page,
  site,
}) => {
  const gate = hold();
  serveHeader(site);
  site.file.set(rawPath, {
    status: 200,
    body: fullFile,
    release: gate.promise,
  });
  await openFixture(page, site, filesPath, cutPage);

  await expect(page.locator(loadingCells).first()).toBeVisible();
  await expect(
    page.locator(`${afterBody} td`).filter({ hasText: "Lantau" }),
  ).toHaveCount(0);
  await expect(page.locator(`${beforeBody} td.csv-diff-loading`)).toHaveCount(
    0,
  );
  const gapsBefore = await page
    .locator(`${afterBody} tr.csv-diff-row-gap`)
    .count();
  expect(gapsBefore).toBeGreaterThan(0);

  gate.release();

  await expect(page.locator(loadingCells)).toHaveCount(0);
  const record = page
    .locator(`${afterBody} td`)
    .filter({ hasText: "Hong Kong" });
  await expect(record).toHaveCount(1);
  await expect(record).toContainText("Central");
  await expect(record).toContainText("Lantau");
  await expect(page.locator(`${afterBody} tr.csv-diff-row-gap`)).toHaveCount(
    gapsBefore,
  );
  expect(site.fileRequests).toEqual([rawPath]);
});

test("keeps the fragment rows on the before side, which has no base ref on Classic UI", async ({
  page,
  site,
}) => {
  serveHeader(site);
  site.file.set(rawPath, { status: 200, body: fullFile });
  await openFixture(page, site, filesPath, cutPage);

  await expect(
    page.locator(`${afterBody} td`).filter({ hasText: "Hong Kong" }),
  ).toHaveCount(1);
  await expect(page.locator(`${beforeBody} td.csv-diff-loading`)).toHaveCount(
    0,
  );
  await expect(
    page.locator(`${beforeBody} td`).filter({ hasText: "Hong Kong" }),
  ).toHaveCount(0);
  await expect(
    page.locator(`${beforeBody} td`).filter({ hasText: /^New Territories/ }),
  ).toHaveCount(1);
});

test("a failed full-file fetch leaves the after fragment rows and no loading cell", async ({
  page,
  site,
}) => {
  serveHeader(site);
  site.file.set(rawPath, { status: 404 });
  await openFixture(page, site, filesPath, cutPage);

  await expect(
    page.locator(`${afterBody} td`).filter({ hasText: /^New Territories/ }),
  ).toHaveCount(1);
  await expect(
    page.locator(".csv-diff-body-table td.csv-diff-loading"),
  ).toHaveCount(0);
  await expect(
    page.locator(`${afterBody} td`).filter({ hasText: "Hong Kong" }),
  ).toHaveCount(0);
});

test("toggling raw and back makes no further raw request", async ({
  page,
  site,
}) => {
  serveHeader(site);
  site.file.set(rawPath, { status: 200, body: fullFile });
  await openFixture(page, site, filesPath, cutPage);
  await expect(
    page.locator(`${afterBody} td`).filter({ hasText: "Hong Kong" }),
  ).toHaveCount(1);
  const headerCount = site.rawRequests.length;
  const fileCount = site.fileRequests.length;

  const button = page.locator(".csv-diff-toggle-btn");
  await button.click();
  await expect(button).toHaveText("Table View");
  await button.click();
  await expect(button).toHaveText("Raw Diff");

  expect(site.rawRequests).toHaveLength(headerCount);
  expect(site.fileRequests).toHaveLength(fileCount);
});
