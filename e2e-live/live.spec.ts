import {
  commitPath,
  expect,
  filesPath,
  fixtureCsv,
  test,
} from "../e2e/fixtures";

const selectors = {
  preview: {
    region: 'div[role="region"]',
    table: 'table[role="grid"]',
    content: ":scope > :nth-child(2)",
  },
  classic: {
    region: ".file.js-file[data-tagsearch-path]",
    table: "table.diff-table",
    content: ".js-file-content",
  },
};

const cases = [
  {
    title: "Preview UI commit page, split",
    ui: "preview",
    url: `${commitPath}?diff=split`,
    csv: "wide",
    rawCells: 4,
  },
  {
    title: "Preview UI commit page, unified",
    ui: "preview",
    url: `${commitPath}?diff=unified`,
    csv: "wide",
    rawCells: 3,
  },
  {
    title: "Classic UI PR files page, split",
    ui: "classic",
    url: `${filesPath}?diff=split`,
    csv: "sample",
    rawCells: 4,
  },
] as const;

for (const { title, ui, url, csv, rawCells } of cases) {
  test(title, async ({ page }) => {
    const s = selectors[ui];
    const target = page
      .locator(s.region)
      .filter({ hasText: `${csv}.csv` })
      .first();
    const rawDiff = target.locator(`${s.content} > :not(.csv-diff-wrapper)`);
    const rawDisplays = () =>
      rawDiff.evaluateAll((els) => [
        ...new Set(els.map((el) => (el as HTMLElement).style.display)),
      ]);

    await page.goto(url);

    await test.step("GitHub rendered the intended UI", async () => {
      const classic = page.locator(selectors.classic.region);
      if (ui === "classic") await expect(classic).not.toHaveCount(0);
      else await expect(classic).toHaveCount(0);
      await expect(
        target.locator(s.table).locator("tr").first().locator("th"),
        "GitHub rendered a different diff layout than the query asked for",
      ).toHaveCount(rawCells);
    });

    await test.step("extension contract", async () => {
      const wrapper = target.locator(".csv-diff-wrapper");
      await wrapper.waitFor({ state: "attached", timeout: 30_000 });

      await expect(wrapper).toHaveCount(1);
      await expect(target.locator(".csv-diff-toggle-btn")).toHaveCount(1);
      const sides = wrapper.locator(".csv-diff-side");
      await expect(sides).toHaveCount(2);

      const read = (side: number) =>
        sides.nth(side).evaluate((el) =>
          Array.from(
            el.querySelectorAll(
              ".csv-diff-header-table tr, .csv-diff-body-table tr:not(.csv-diff-row-empty)",
            ),
          ).map((row) =>
            Array.from(row.querySelectorAll("th, td"))
              .slice(1)
              .map((c) => c.textContent ?? ""),
          ),
        );

      expect(await read(0)).toEqual(fixtureCsv(`${csv}.before.csv`));
      expect(await read(1)).toEqual(fixtureCsv(`${csv}.after.csv`));

      await expect(rawDiff).not.toHaveCount(0);
      expect(await rawDisplays()).toEqual(["none"]);

      const button = target.locator(".csv-diff-toggle-btn");
      await button.click();
      await expect(wrapper).toBeHidden();
      expect(await rawDisplays()).toEqual([""]);
      await button.click();
      await expect(wrapper).toBeVisible();
      expect(await rawDisplays()).toEqual(["none"]);
    });
  });
}
