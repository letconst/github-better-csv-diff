import type { Page } from "@playwright/test";
import {
  commitPath,
  expect,
  filesPath,
  fixtureHtml,
  fixturePage,
  openFixture,
  prPath,
  test,
} from "./fixtures";

declare global {
  interface Window {
    __pristine?: string;
  }
}

const fileContainer = "div.file.js-file[data-tagsearch-path]";
const classicHtml = fixtureHtml("classic-pr-split");

/** Records the raw markup of `selector` at DOMContentLoaded, before any injection. */
async function capturePristine(
  page: Page,
  selector: string,
  prop: "innerHTML" | "outerHTML" = "innerHTML",
) {
  await page.addInitScript(
    ({ sel, prop }) => {
      document.addEventListener("DOMContentLoaded", () => {
        window.__pristine = document.querySelector(sel)?.[prop];
      });
    },
    { sel: selector, prop },
  );
}

const readPristine = (page: Page) =>
  page.evaluate(() => window.__pristine as string);

let extraContainers = 0;

/**
 * Appends another CSV container and waits for its toggle: once that appears the
 * observer has processed the mutation batch that preceded it.
 */
async function awaitObserverPass(page: Page) {
  const extraPath = `example/extra${extraContainers++}.csv`;
  await page.evaluate(
    ({ html, from, to }) => {
      document.body.insertAdjacentHTML("beforeend", html.replace(from, to));
    },
    {
      html: classicHtml,
      from: 'data-tagsearch-path="example/sample.csv"',
      to: `data-tagsearch-path="${extraPath}"`,
    },
  );
  await expect(
    page.locator(`[data-tagsearch-path="${extraPath}"] .csv-diff-toggle-btn`),
  ).toHaveCount(1);
}

test("Classic collapse only hides the body: toggle and wrapper stay, no placeholder", async ({
  page,
  site,
}) => {
  await openFixture(page, site, filesPath, fixturePage("classic-pr-split"));
  const original = page.locator(
    `${fileContainer}[data-tagsearch-path="example/sample.csv"]`,
  );
  const wrapper = original.locator(".csv-diff-wrapper");
  const button = original.locator(".csv-diff-toggle-btn");

  await page.evaluate(() => {
    const file = document.querySelector(".js-file")!;
    file.classList.remove("open");
    document.querySelector<HTMLElement>(".js-file-content")!.style.display =
      "none";
    document.body.append(document.createElement("p"));
  });
  await awaitObserverPass(page);

  await expect(wrapper).toHaveCount(1);
  await expect(button).toHaveCount(1);
  await expect(button).toBeEnabled();

  await page.evaluate(() => {
    document.querySelector(".js-file")!.classList.add("open");
    document.querySelector<HTMLElement>(".js-file-content")!.style.display = "";
  });
  await awaitObserverPass(page);

  await expect(wrapper).toBeVisible();
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(wrapper).toBeHidden();
});

test("Preview collapse removes the body: the surviving toggle becomes a disabled placeholder and re-expand re-processes", async ({
  page,
  site,
}) => {
  const region = 'div[role="region"]';
  const body = `${region} > :nth-child(2)`;
  await capturePristine(page, body, "outerHTML");
  await openFixture(
    page,
    site,
    `${prPath}/changes`,
    fixturePage("preview-pr-split"),
  );
  const pristine = await readPristine(page);
  const wrapper = page.locator(`${region} .csv-diff-wrapper`);
  const button = page.locator(`${region} .csv-diff-toggle-btn`);

  await page.evaluate((sel) => document.querySelector(sel)!.remove(), body);

  await expect(wrapper).toHaveCount(0);
  await expect(button).toHaveCount(1);
  await expect(button).toBeDisabled();
  await expect(button).toHaveAttribute("aria-disabled", "true");
  await expect(button).toHaveAttribute("title", /Expand the file/);
  await expect(button).not.toHaveClass(/csv-diff-toggle-active/);

  await button.evaluate((el) => el.setAttribute("data-same-node", ""));
  await awaitObserverPass(page);
  await awaitObserverPass(page);
  await expect(button).toHaveCount(1);
  await expect(button).toHaveAttribute("data-same-node", "");

  await page.evaluate(
    ({ sel, html }) =>
      document.querySelector(sel)!.insertAdjacentHTML("beforeend", html),
    { sel: region, html: pristine },
  );

  await expect(wrapper).toHaveCount(1);
  await expect(button).toHaveCount(1);
  await expect(button).toBeEnabled();
  await expect(button).toHaveClass(/csv-diff-toggle-active/);
  await button.click();
  await expect(wrapper).toBeHidden();
});

test("Preview collapse in raw mode keeps the Table View placeholder and re-expands in raw mode", async ({
  page,
  site,
}) => {
  const region = 'div[role="region"]';
  const body = `${region} > :nth-child(2)`;
  await capturePristine(page, body, "outerHTML");
  await openFixture(
    page,
    site,
    `${prPath}/changes`,
    fixturePage("preview-pr-split"),
  );
  const pristine = await readPristine(page);
  const wrapper = page.locator(`${region} .csv-diff-wrapper`);
  const button = page.locator(`${region} .csv-diff-toggle-btn`);

  await button.click();
  await expect(wrapper).toBeHidden();
  await expect(button).toHaveText("Table View");

  await page.evaluate((sel) => document.querySelector(sel)!.remove(), body);

  await expect(button).toHaveCount(1);
  await expect(button).toBeDisabled();
  await expect(button).toHaveText("Table View");
  await expect(button).not.toHaveClass(/csv-diff-toggle-active/);

  await page.evaluate(
    ({ sel, html }) =>
      document.querySelector(sel)!.insertAdjacentHTML("beforeend", html),
    { sel: region, html: pristine },
  );

  await expect(wrapper).toHaveCount(1);
  await expect(wrapper).toBeHidden();
  await expect(page.locator(region)).toHaveAttribute("data-csv-diff-raw", "");
  await expect(button).toHaveCount(1);
  await expect(button).toBeEnabled();
  await expect(button).toHaveText("Table View");
  const rawDisplays = await page
    .locator(`${body} > :not(.csv-diff-wrapper)`)
    .evaluateAll((els) => els.map((el) => (el as HTMLElement).style.display));
  expect(rawDisplays.length).toBeGreaterThan(0);
  expect(rawDisplays.every((d) => d !== "none")).toBe(true);

  await button.click();
  await expect(wrapper).toBeVisible();
  await expect(button).toHaveText("Raw Diff");
});

test("snapshot restore replaces the stale wrapper and re-attaches a working toggle", async ({
  page,
  site,
}) => {
  await openFixture(page, site, filesPath, fixturePage("classic-pr-split"));
  await page.evaluate(() => {
    document
      .querySelector(".csv-diff-wrapper")!
      .setAttribute("data-stale", "1");
  });

  await page.evaluate((selector) => {
    document.dispatchEvent(new Event("turbo:before-cache"));
    const container = document.querySelector(selector)!;
    container.replaceWith(container.cloneNode(true));
    document.dispatchEvent(new Event("turbo:load"));
  }, fileContainer);

  const wrapper = page.locator(".csv-diff-wrapper");
  const button = page.locator(".csv-diff-toggle-btn");
  await expect(wrapper).toHaveCount(1);
  await expect(wrapper).not.toHaveAttribute("data-stale", "1");
  await expect(button).toHaveCount(1);
  await expect(wrapper).toBeVisible();
  const rawChild = page
    .locator(".js-file-content > :not(.csv-diff-wrapper)")
    .first();
  await expect(rawChild).toHaveCSS("display", "none");

  await button.click();
  await expect(wrapper).toBeHidden();
  await expect(rawChild).not.toHaveCSS("display", "none");
});

test("unrelated DOM mutations leave exactly one wrapper and one toggle", async ({
  page,
  site,
}) => {
  await openFixture(page, site, filesPath, fixturePage("classic-pr-split"));
  const original = page.locator(
    `${fileContainer}[data-tagsearch-path="example/sample.csv"]`,
  );

  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      const p = document.createElement("p");
      document.body.append(p);
      p.remove();
    });
    await awaitObserverPass(page);
    await expect(original.locator(".csv-diff-wrapper")).toHaveCount(1);
    await expect(original.locator(".csv-diff-toggle-btn")).toHaveCount(1);
  }
});
