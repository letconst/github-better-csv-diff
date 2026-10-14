import fs from "node:fs";
import path from "node:path";
import {
  type BrowserContext,
  test as base,
  chromium,
  type Page,
} from "@playwright/test";
import Papa from "papaparse";

export const prPath = "/letconst/github-better-csv-diff/pull/2";
export const filesPath = `${prPath}/files`;
export const commitPath =
  "/letconst/github-better-csv-diff/commit/20765189583844cb8ff3a29854fad075cad2aaf2";

const repoRoot = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(repoRoot, "dist", "chrome-mv3");

interface RawResponse {
  status: number;
  body?: string;
  /** When set, the response is withheld until this promise resolves. */
  release?: Promise<void>;
}

export interface Site {
  pages: Map<string, string>;
  /** Responses to Range requests (the header fetch), by raw path. */
  raw: Map<string, RawResponse>;
  /** Responses to plain requests (the full-file fetch), by raw path. */
  file: Map<string, RawResponse>;
  /** Raw paths requested with a Range header. */
  rawRequests: string[];
  /** Raw paths requested without a Range header. */
  fileRequests: string[];
}

export function hold(): { release: () => void; promise: Promise<void> } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, promise };
}

export function fixtureHtml(name: string): string {
  return fs.readFileSync(
    path.join(repoRoot, "test", "fixtures", "github", `${name}.html`),
    "utf8",
  );
}

export function fixtureCsv(name: string): string[][] {
  const text = fs.readFileSync(
    path.join(repoRoot, "test", "fixtures", "csv", name),
    "utf8",
  );
  return Papa.parse<string[]>(text, { skipEmptyLines: true }).data;
}

/** GitHub pins the file header this far from the viewport top. */
export const stickyTop = 60;

const stickyFileHeader = `<style>.file-header{position:sticky;top:${stickyTop}px}</style>`;

export function documentWith(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">${stickyFileHeader}</head><body>${body}</body></html>`;
}

export function fixturePage(name: string): string {
  return documentWith(fixtureHtml(name));
}

/** Serve `html` at `path`, load it and wait for the extension to inject a wrapper. */
export async function openFixture(
  page: Page,
  site: Site,
  path: string,
  html: string,
): Promise<void> {
  site.pages.set(path, html);
  await page.goto(path);
  await page
    .locator(".csv-diff-wrapper")
    .first()
    .waitFor({ state: "attached" });
}

const rawPathPattern = /^\/[^/]+\/[^/]+\/raw\//;

export const test = base.extend<{ context: BrowserContext; site: Site }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructuring pattern
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      // Bundled Chromium (not headless shell) is what allows extensions headless.
      channel: "chromium",
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await use(context);
    await context.close();
  },

  site: async ({ context }, use) => {
    const site: Site = {
      pages: new Map(),
      raw: new Map(),
      file: new Map(),
      rawRequests: [],
      fileRequests: [],
    };

    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === "chrome-extension:") return route.continue();
      if (url.origin !== "https://github.com") return route.abort();

      if (rawPathPattern.test(url.pathname)) {
        const ranged = "range" in route.request().headers();
        (ranged ? site.rawRequests : site.fileRequests).push(url.pathname);
        const response = (ranged ? site.raw : site.file).get(url.pathname);
        if (!response) return route.abort();
        await response.release;
        return route.fulfill({
          status: response.status,
          contentType: "text/csv",
          body: response.body ?? "",
        });
      }
      const html = site.pages.get(url.pathname);
      if (html === undefined) return route.abort();
      return route.fulfill({ contentType: "text/html", body: html });
    });

    await use(site);
  },
});

export { expect } from "@playwright/test";
