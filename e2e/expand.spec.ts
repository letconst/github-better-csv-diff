import type { Page } from "@playwright/test";
import {
  commitPath,
  documentWith,
  expect,
  filesPath,
  fixtureHtml,
  hold,
  openFixture,
  prPath,
  type Site,
  test,
} from "./fixtures";

const rawPath =
  "/letconst/github-better-csv-diff/raw/20765189583844cb8ff3a29854fad075cad2aaf2/example/large-file.csv";
const headerLine =
  "record_id,city,country,population,area_km2,timezone,founded_year\n";

const partialComparisonUrl =
  "/letconst/github-better-csv-diff/pull/2/show_partial_comparison?base_commit_oid=96e7fb85721f6b5ca4a0752cfd4512076f5bd223&end_commit_oid=20765189583844cb8ff3a29854fad075cad2aaf2&partial=pull_requests%2Fstale_comparison&start_commit_oid=96e7fb85721f6b5ca4a0752cfd4512076f5bd223";

const largeFilePage = documentWith(
  `<div data-url="${partialComparisonUrl}"></div>${fixtureHtml("classic-pr-split-large-file")}`,
);

const bodyRows = (side: "first-child" | "last-child") =>
  `.csv-diff-side:${side} .csv-diff-body-table tbody tr`;
const beforeRows = bodyRows("first-child");
const firstLineNum = `${beforeRows}:not(.csv-diff-row-gap) .csv-diff-line-num`;

/** Stands in for GitHub's JS: the native Expand Up link inserts rows 21-23 after the hunk row. */
async function stubNativeExpandUp(page: Page) {
  await page.evaluate(() => {
    const link = document.querySelector<HTMLElement>(
      'a.js-expand[aria-label="Expand Up"]',
    )!;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const hunkRow = link.closest("tr")!;
      const template = hunkRow.nextElementSibling as HTMLElement;
      let anchor: Element = hunkRow;
      for (const n of [21, 22, 23]) {
        const row = template.cloneNode(true) as HTMLElement;
        for (const num of row.querySelectorAll("td[data-line-number]")) {
          num.setAttribute("data-line-number", String(n));
        }
        for (const text of row.querySelectorAll(".blob-code-inner")) {
          text.textContent = `R0${n},X,Y,1,1,Z,1000`;
        }
        anchor.after(row);
        anchor = row;
      }
      hunkRow.querySelector(".blob-code-hunk")!.textContent =
        "@@ -21,14 +21,14 @@";
    });
  });
}

async function openLargeFile(page: Page, site: Site, gate?: Promise<void>) {
  site.raw.set(rawPath, { status: 206, body: headerLine, release: gate });
  await openFixture(page, site, filesPath, largeFilePage);
}

test("gap rows with up/down expand buttons frame the before side", async ({
  page,
  site,
}) => {
  await openLargeFile(page, site);

  const rows = page.locator(beforeRows);
  await expect(rows.first()).toHaveClass(/csv-diff-row-gap/);
  await expect(rows.last()).toHaveClass(/csv-diff-row-gap/);
  const first = rows.first().locator("button.csv-diff-expand-btn");
  const last = rows.last().locator("button.csv-diff-expand-btn");
  await expect(first).toHaveCount(1);
  await expect(first).toHaveAttribute("data-direction", "up");
  await expect(first).toHaveAttribute("aria-label", "Expand Up");
  await expect(last).toHaveCount(1);
  await expect(last).toHaveAttribute("data-direction", "down");
  await expect(last).toHaveAttribute("aria-label", "Expand Down");
});

test("expanding up disables both sides' buttons and rebuilds the table with the inserted rows", async ({
  page,
  site,
}) => {
  await openLargeFile(page, site);
  await stubNativeExpandUp(page);
  const before = await page.locator(beforeRows).count();
  const upButtons = page.locator(
    'tr.csv-diff-row-gap:first-child button[data-direction="up"]',
  );
  await expect(upButtons).toHaveCount(2);

  await upButtons.first().dispatchEvent("click");

  await expect(page.locator(firstLineNum).first()).toHaveText("21");
  await expect(page.locator(beforeRows)).toHaveCount(before + 3);
  await expect(page.locator(".csv-diff-wrapper")).toHaveCount(1);
  await expect(page.locator(".csv-diff-toggle-btn")).toHaveCount(1);
});

test("rows inserted while the header fetch is pending still rebuild the table", async ({
  page,
  site,
}) => {
  const gate = hold();
  site.raw.set(rawPath, {
    status: 206,
    body: headerLine,
    release: gate.promise,
  });
  await openFixture(page, site, filesPath, largeFilePage);
  await expect(page.locator(".csv-diff-loading")).toHaveCount(2);
  await stubNativeExpandUp(page);
  const before = await page.locator(beforeRows).count();

  await page
    .locator('tr.csv-diff-row-gap:first-child button[data-direction="up"]')
    .first()
    .dispatchEvent("click");
  gate.release();

  await expect(page.locator(firstLineNum).first()).toHaveText("21");
  await expect(page.locator(beforeRows)).toHaveCount(before + 3);
  await expect(page.locator(".csv-diff-loading")).toHaveCount(0);
  await expect(page.locator(".csv-diff-wrapper")).toHaveCount(1);
});

const region = 'div[role="region"]';
const previewPage = documentWith(fixtureHtml("preview-pr-split"));

/** Opens the Preview page and returns a function that swaps the region for a pristine copy, as GitHub does on expand. */
async function openPreview(page: Page, site: Site) {
  await page.addInitScript((sel) => {
    document.addEventListener("DOMContentLoaded", () => {
      (window as unknown as { __region: string }).__region =
        document.querySelector(sel)!.outerHTML;
    });
  }, region);
  await openFixture(page, site, `${prPath}/changes`, previewPage);
  return () =>
    page.evaluate((sel) => {
      const old = document.querySelector(sel)!;
      const html = (window as unknown as { __region: string }).__region;
      const next = new DOMParser().parseFromString(html, "text/html").body
        .firstElementChild!;
      old.replaceWith(next);
    }, region);
}

test("a region re-rendered by GitHub stays in Raw Diff when the user chose it", async ({
  page,
  site,
}) => {
  const replaceRegion = await openPreview(page, site);
  await page.locator(".csv-diff-toggle-btn").click();
  await expect(page.locator(".csv-diff-wrapper")).toBeHidden();

  await replaceRegion();

  const toggle = page.locator(`${region} .csv-diff-toggle-btn`);
  await expect(toggle).toHaveText("Table View");
  await expect(page.locator(region)).toHaveAttribute("data-csv-diff-raw", "");
  await expect(page.locator(".csv-diff-wrapper")).toHaveCSS("display", "none");
  await expect(page.locator('table[role="grid"]').first()).not.toHaveCSS(
    "display",
    "none",
  );
});

test("a region re-rendered by GitHub stays in Table View when the user did not switch", async ({
  page,
  site,
}) => {
  const replaceRegion = await openPreview(page, site);
  await replaceRegion();

  await expect(page.locator(`${region} .csv-diff-toggle-btn`)).toHaveText(
    "Raw Diff",
  );
  await expect(page.locator(".csv-diff-wrapper")).toBeVisible();
  await expect(page.locator(region)).not.toHaveAttribute("data-csv-diff-raw");
});

test("the Raw Diff choice does not leak to the same file on another diff route", async ({
  page,
  site,
}) => {
  await openPreview(page, site);
  await page.locator(".csv-diff-toggle-btn").click();
  await expect(page.locator(".csv-diff-wrapper")).toBeHidden();

  await page.evaluate(
    ({ path, html }) => {
      history.pushState({}, "", path);
      document.body.innerHTML = html;
    },
    { path: commitPath, html: fixtureHtml("preview-pr-split") },
  );

  await expect(page.locator(`${region} .csv-diff-toggle-btn`)).toHaveText(
    "Raw Diff",
    { timeout: 3000 },
  );
  await expect(page.locator(".csv-diff-wrapper")).toBeVisible();
});
