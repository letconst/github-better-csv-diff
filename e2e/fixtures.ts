import fs from "node:fs";
import path from "node:path";
import { type BrowserContext, test as base, chromium } from "@playwright/test";

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

interface Site {
  pages: Map<string, string>;
  raw: Map<string, RawResponse>;
  rawRequests: string[];
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

const stickyFileHeader =
  "<style>.file-header{position:sticky;top:60px}</style>";

export function documentWith(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">${stickyFileHeader}</head><body>${body}</body></html>`;
}

export function fixturePage(name: string): string {
  return documentWith(fixtureHtml(name));
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
    const site: Site = { pages: new Map(), raw: new Map(), rawRequests: [] };

    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === "chrome-extension:") return route.continue();
      if (url.origin !== "https://github.com") return route.abort();

      if (rawPathPattern.test(url.pathname)) {
        site.rawRequests.push(url.pathname);
        const response = site.raw.get(url.pathname);
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
