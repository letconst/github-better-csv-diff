import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  // The URL-polling test is timing-sensitive.
  workers: 1,
  reporter: "list",
  use: { baseURL: "https://github.com", trace: "retain-on-failure" },
});
