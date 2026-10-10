import type { Page } from "@playwright/test";
import {
  documentWith,
  expect,
  filesPath,
  fixtureHtml,
  prPath,
  test,
} from "./fixtures";

const nonDiffBody = "<p>conversation</p>";
const sentinel = fixtureHtml("classic-pr-split");
const second = sentinel.replace(
  'data-tagsearch-path="example/sample.csv"',
  'data-tagsearch-path="example/other.csv"',
);
const secondToggle =
  '[data-tagsearch-path="example/other.csv"] .csv-diff-toggle-btn';

function turboNavigate(page: Page, path: string, body: string) {
  return page.evaluate(
    ({ path, body }) => {
      document.dispatchEvent(new Event("turbo:before-render"));
      history.pushState({}, "", path);
      document.body.innerHTML = body;
      document.dispatchEvent(new Event("turbo:load"));
    },
    { path, body },
  );
}

test("pushState to a diff route without Turbo events injects via URL polling", async ({
  page,
  site,
}) => {
  site.pages.set(filesPath, documentWith(sentinel));
  await page.goto(filesPath);
  await expect(page.locator(".csv-diff-toggle-btn")).toHaveCount(1);

  // Turbo navigation disconnects the observer, so only URL polling can inject
  // afterwards. /changes differs from the polled /files, so the change is seen.
  await turboNavigate(page, prPath, nonDiffBody);
  await page.evaluate(
    ({ path, body }) => {
      history.pushState({}, "", path);
      document.body.innerHTML = body;
    },
    { path: `${prPath}/changes`, body: second },
  );

  await expect(page.locator(secondToggle)).toHaveCount(1, { timeout: 2000 });
});

test("Turbo navigation diff -> non-diff disconnects the observer", async ({
  page,
  site,
}) => {
  site.pages.set(prPath, documentWith(nonDiffBody));
  await page.goto(prPath);

  await turboNavigate(page, filesPath, sentinel);
  await expect(page.locator(".csv-diff-toggle-btn")).toHaveCount(1);

  await turboNavigate(page, prPath, nonDiffBody);
  await page.evaluate((body) => {
    document.body.insertAdjacentHTML("beforeend", body);
  }, second);

  // Negative check: outlast the observer's 300 ms debounce.
  await page.waitForTimeout(800);
  await expect(page.locator(secondToggle)).toHaveCount(0);
  await expect(page.locator(".csv-diff-wrapper")).toHaveCount(0);
});

test("Turbo load on the same path with a replaced body injects the new container", async ({
  page,
  site,
}) => {
  site.pages.set(filesPath, documentWith(sentinel));
  await page.goto(filesPath);
  await expect(page.locator(".csv-diff-toggle-btn")).toHaveCount(1);

  await turboNavigate(page, filesPath, second);

  await expect(page.locator(secondToggle)).toHaveCount(1);
  await expect(page.locator(".csv-diff-wrapper")).toHaveCount(1);
});

test("a container appended after load is injected via the MutationObserver", async ({
  page,
  site,
}) => {
  site.pages.set(filesPath, documentWith(sentinel));
  await page.goto(filesPath);
  await expect(page.locator(".csv-diff-toggle-btn")).toHaveCount(1);

  await page.evaluate((body) => {
    document.body.insertAdjacentHTML("beforeend", body);
  }, second);

  await expect(page.locator(secondToggle)).toHaveCount(1);
});
