import {
  documentWith,
  expect,
  filesPath,
  fixtureHtml,
  hold,
  test,
} from "./fixtures";

const rawPath =
  "/letconst/github-better-csv-diff/raw/20765189583844cb8ff3a29854fad075cad2aaf2/example/large-file.csv";
const partialComparisonUrl =
  "/letconst/github-better-csv-diff/pull/2/show_partial_comparison?base_commit_oid=96e7fb85721f6b5ca4a0752cfd4512076f5bd223&end_commit_oid=20765189583844cb8ff3a29854fad075cad2aaf2&partial=pull_requests%2Fstale_comparison&start_commit_oid=96e7fb85721f6b5ca4a0752cfd4512076f5bd223";

const largeFilePage = documentWith(
  `<div data-url="${partialComparisonUrl}"></div>${fixtureHtml("classic-pr-split-large-file")}`,
);

const headerCells = (side: "first-child" | "last-child") =>
  `.csv-diff-side:${side} .csv-diff-header-table th`;

test("fetched header replaces the loading header on both sides with a single request", async ({
  page,
  site,
}) => {
  const fetched = ["id", "name", "country", "pop", "area", "tz", "year"];
  site.pages.set(filesPath, largeFilePage);
  site.raw.set(rawPath, {
    status: 206,
    body: `${fetched.join(",")}\nR001,Tokyo,Japan,1,1,Asia/Tokyo,1457\n`,
  });
  await page.goto(filesPath);

  const expected = ["#", ...fetched];
  await expect(page.locator(headerCells("first-child"))).toHaveText(expected);
  await expect(page.locator(headerCells("last-child"))).toHaveText(expected);
  await expect(page.locator(".csv-diff-loading")).toHaveCount(0);
  expect(site.rawRequests).toEqual([rawPath]);
});

test("failed fetch ends loading and falls back to the first diff row as header on both sides", async ({
  page,
  site,
}) => {
  const gate = hold();
  site.pages.set(filesPath, largeFilePage);
  site.raw.set(rawPath, { status: 404, release: gate.promise });
  await page.goto(filesPath);
  await expect(page.locator(".csv-diff-loading")).toHaveCount(2);
  await expect.poll(() => site.rawRequests).toEqual([rawPath]);

  gate.release();

  const firstDiffRow = [
    "#",
    "R023",
    "Manchester",
    "UK",
    "553000",
    "115",
    "Europe/London",
    "1301",
  ];
  await expect(page.locator(headerCells("first-child"))).toHaveText(
    firstDiffRow,
  );
  await expect(page.locator(headerCells("last-child"))).toHaveText(
    firstDiffRow,
  );
  await expect(page.locator(".csv-diff-loading")).toHaveCount(0);
});

test("navigating away while the fetch is pending raises no error and leaves the detached wrapper alone", async ({
  page,
  site,
}) => {
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  const gate = hold();
  site.pages.set(filesPath, largeFilePage);
  site.raw.set(rawPath, {
    status: 206,
    body: "a,b,c\n",
    release: gate.promise,
  });
  await page.goto(filesPath);
  await expect(page.locator(".csv-diff-loading")).toHaveCount(2);
  await expect.poll(() => site.rawRequests).toEqual([rawPath]);

  await page.evaluate(() => {
    (window as unknown as { detached: Element | null }).detached =
      document.querySelector(".csv-diff-wrapper");
    document.dispatchEvent(new Event("turbo:before-render"));
    history.pushState({}, "", "/letconst/github-better-csv-diff/pull/2");
    document.body.innerHTML = "<p>conversation</p>";
    document.dispatchEvent(new Event("turbo:load"));
  });

  const responded = page.waitForResponse(/\/raw\//);
  gate.release();
  await responded;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 0)),
      ),
  );

  expect(errors).toEqual([]);
  const stillLoading = await page.evaluate(
    () =>
      (window as unknown as { detached: Element }).detached.querySelectorAll(
        ".csv-diff-loading",
      ).length,
  );
  expect(stillLoading).toBe(2);
});
