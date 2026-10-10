import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig({
  ...base,
  testDir: "e2e-live",
  retries: 1,
  timeout: 60_000,
  use: {
    ...base.use,
    locale: "en-US",
    screenshot: "only-on-failure",
  },
});
