import type { Page } from "@playwright/test";
import {
  commitPath,
  documentWith,
  expect,
  filesPath,
  fixtureHtml,
  openFixture,
  type Site,
  stickyTop,
  test,
} from "./fixtures";

const tolerance = 1;

/** Classic sample with an After-only multiline cell (quoted field over two `+` rows). */
function classicWithMultiline(): string {
  const html = fixtureHtml("classic-pr-split");
  const afterCell = `<span class="blob-code-inner blob-code-marker" data-code-marker="+"><span class="pl-s">1</span><span class="pl-k">,</span><span class="pl-s">Alice Johnson</span><span class="pl-k">,</span><span class="pl-s">alice.johnson@example.<span class="x x-first x-last">org</span></span><span class="pl-k">,</span><span class="pl-s">Engineering</span><span class="pl-k">,</span><span class="pl-s x x-first x-last">85000</span></span>`;
  // The fixture's own closing </td></tr> ends the appended continuation row.
  const twoRows = `<span class="blob-code-inner blob-code-marker" data-code-marker="+">1,&quot;Alice</span></td></tr><tr data-hunk="x"><td class="blob-num blob-num-empty empty-cell"></td><td data-split-side="left" class="empty-cell"></td><td class="blob-num blob-num-addition" data-line-number="3"></td><td data-split-side="right" class="code-review blob-code blob-code-addition js-file-line"><span class="blob-code-inner blob-code-marker" data-code-marker="+">Johnson&quot;,alice.johnson@example.org,Engineering,85000</span>`;
  const replaced = html.replace(afterCell, twoRows);
  expect(replaced).not.toBe(html);
  return replaced;
}

interface OpenOptions {
  style?: string;
  /** Adds scroll room so sticky behaviour can be exercised. */
  tall?: boolean;
}

function pageWith(body: string, { style = "", tall = false }: OpenOptions) {
  const spacer = tall ? `<div style="height:4000px"></div>` : "";
  return documentWith(
    `<style id="fixture-extra">${style}</style>${body}${spacer}`,
  );
}

const openClassic = (page: Page, site: Site, options: OpenOptions = {}) =>
  openFixture(page, site, filesPath, pageWith(classicWithMultiline(), options));

async function columnAlignment(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll(".csv-diff-side")].map((side) => {
      const ths = side.querySelectorAll(".csv-diff-header-table th");
      const tds = side.querySelectorAll(
        ".csv-diff-body-table tbody tr:first-child > *",
      );
      return [...ths].map((th, i) => {
        const a = th.getBoundingClientRect();
        const b = tds[i]?.getBoundingClientRect();
        return {
          dw: a.width - (b?.width ?? Number.NaN),
          dl: a.left - (b?.left ?? Number.NaN),
        };
      });
    }),
  );
}

function expectAligned(sides: { dw: number; dl: number }[][]) {
  expect(sides).toHaveLength(2);
  for (const cols of sides) {
    expect(cols.length).toBeGreaterThan(1);
    for (const { dw, dl } of cols) {
      expect(Math.abs(dw)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(dl)).toBeLessThanOrEqual(tolerance);
    }
  }
}

test("paired row heights match, including a multiline cell on one side", async ({
  page,
  site,
}) => {
  await openClassic(page, site);

  await expect(page.locator(".csv-diff-body-table br")).not.toHaveCount(0);
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll(".csv-diff-body-table")].map((t) =>
      [...t.querySelectorAll("tr")].map(
        (r) => r.getBoundingClientRect().height,
      ),
    ),
  );
  expect(heights[0]).toHaveLength(heights[1]!.length);
  expect(heights[0]!.length).toBeGreaterThan(2);
  heights[0]!.forEach((h, i) => {
    expect(Math.abs(h - heights[1]![i]!)).toBeLessThanOrEqual(tolerance);
  });
  expect(Math.max(...heights[1]!)).toBeGreaterThan(Math.min(...heights[1]!));
});

test("header and body columns line up on both sides", async ({
  page,
  site,
}) => {
  await openClassic(page, site);
  expectAligned(await columnAlignment(page));
});

test("horizontal scroll is mirrored to the other side and the header strips; line numbers stay put", async ({
  page,
  site,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await openFixture(
    page,
    site,
    commitPath,
    pageWith(fixtureHtml("preview-commit-split"), {}),
  );

  const bodies = page.locator(".csv-diff-body");
  const overflow = await bodies.evaluateAll((els) =>
    els.map((el) => el.scrollWidth - el.clientWidth),
  );
  expect(overflow.every((o) => o > 150)).toBe(true);

  const lineNumLefts = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".csv-diff-body .csv-diff-line-num")].map(
        (el) => el.getBoundingClientRect().left,
      ),
    );
  const before = await lineNumLefts();

  await bodies.first().evaluate((el) => {
    el.scrollLeft = 150;
    el.dispatchEvent(new Event("scroll"));
  });

  await expect
    .poll(() =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll(
            ".csv-diff-body, .csv-diff-header-strip",
          ),
        ].map((el) => el.scrollLeft),
      ),
    )
    .toEqual([150, 150, 150, 150]);

  const after = await lineNumLefts();
  expect(after).toHaveLength(before.length);
  after.forEach((left, i) => {
    expect(Math.abs(left - before[i]!)).toBeLessThanOrEqual(tolerance);
  });
});

async function scrollPastTableTop(page: Page) {
  await page.evaluate(() => {
    const table = document.querySelector(".csv-diff-container")!;
    window.scrollTo(0, table.getBoundingClientRect().top + window.scrollY + 40);
  });
}

/** Distance between each header strip top and the file header bottom. */
const stripGaps = (page: Page) =>
  page.evaluate(() => {
    const bottom = document
      .querySelector(".file-header")!
      .getBoundingClientRect().bottom;
    return [...document.querySelectorAll(".csv-diff-header-strip")].map(
      (el) => el.getBoundingClientRect().top - bottom,
    );
  });

const expectStripsFlush = (page: Page) =>
  expect
    .poll(async () => (await stripGaps(page)).map(Math.round))
    .toEqual([0, 0]);

const stickyTopOf = (page: Page) =>
  page
    .locator(".csv-diff-wrapper")
    .evaluate((el) => el.style.getPropertyValue("--csv-diff-sticky-top"));

const fileHeaderHeight = (page: Page) =>
  page.evaluate(
    () =>
      document.querySelector(".file-header")!.getBoundingClientRect().height,
  );

test("header strip pins directly below the file header after scrolling", async ({
  page,
  site,
}) => {
  await openClassic(page, site, { tall: true });
  const height = await fileHeaderHeight(page);
  await expect.poll(() => stickyTopOf(page)).toBe(`${stickyTop + height}px`);

  await scrollPastTableTop(page);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector(".file-header")!.getBoundingClientRect().top,
      ),
    )
    .toBe(stickyTop);
  await expectStripsFlush(page);
});

test("a late-resolving sticky top is picked up on scroll", async ({
  page,
  site,
}) => {
  await openClassic(page, site, {
    style: ".file-header{top:auto}",
    tall: true,
  });
  const height = await fileHeaderHeight(page);
  // top:auto resolves to 0 at inject time, so the offset is short by the sticky top.
  await expect.poll(() => stickyTopOf(page)).toBe(`${height}px`);

  await page.evaluate((top) => {
    document.getElementById("fixture-extra")!.textContent =
      `.file-header{top:${top}px}`;
  }, stickyTop);
  expect(await fileHeaderHeight(page)).toBe(height);
  await scrollPastTableTop(page);

  await expect.poll(() => stickyTopOf(page)).toBe(`${stickyTop + height}px`);
  await expectStripsFlush(page);
});

test("sticky offset follows a file header height change", async ({
  page,
  site,
}) => {
  await openClassic(page, site, { tall: true });
  const height = await fileHeaderHeight(page);
  await expect.poll(() => stickyTopOf(page)).toBe(`${stickyTop + height}px`);

  await page.evaluate(() => {
    const header = document.querySelector<HTMLElement>(".file-header")!;
    header.style.height = `${header.getBoundingClientRect().height + 30}px`;
  });
  await expect
    .poll(() => stickyTopOf(page))
    .toBe(`${stickyTop + height + 30}px`);
});

test("columns stay aligned and strips stay below the file header after a viewport resize", async ({
  page,
  site,
}) => {
  await page.setViewportSize({ width: 1200, height: 700 });
  await openClassic(page, site, {
    style: "@media (max-width:800px){.file-header{top:40px}}",
    tall: true,
  });
  const sideWidth = () =>
    page.evaluate(
      () =>
        document.querySelector(".csv-diff-side")!.getBoundingClientRect().width,
    );
  const widthBefore = await sideWidth();

  await page.setViewportSize({ width: 700, height: 700 });
  await expect.poll(sideWidth).toBeLessThan(widthBefore);

  const height = await fileHeaderHeight(page);
  await expect.poll(() => stickyTopOf(page)).toBe(`${40 + height}px`);
  await expect
    .poll(async () => {
      const sides = await columnAlignment(page);
      return sides.every((cols) =>
        cols.every(
          ({ dw, dl }) =>
            Math.abs(dw) <= tolerance && Math.abs(dl) <= tolerance,
        ),
      );
    })
    .toBe(true);
  expectAligned(await columnAlignment(page));

  await scrollPastTableTop(page);
  await expectStripsFlush(page);
});
