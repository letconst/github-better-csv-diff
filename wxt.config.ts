import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  outDir: "dist",
  modules: ["@wxt-dev/auto-icons"],
  autoIcons: {
    baseIconPath: "assets/icon.svg",
  },
  manifest: ({ browser, manifestVersion }) => {
    // Firefox content scripts run fetch() with the extension's principal, so
    // cross-origin requests require explicit host permissions. Chrome inherits
    // the page's privileges, so it works without them. These hosts cover the
    // CSV header fetch: github.com/.../raw redirects to raw.githubusercontent.com.
    const hostPatterns = [
      "https://github.com/*",
      "https://raw.githubusercontent.com/*",
    ];
    const firefoxHostPermissions =
      browser === "firefox"
        ? manifestVersion === 3
          ? { host_permissions: hostPatterns }
          : { permissions: hostPatterns }
        : {};

    return {
      name: "GitHub Better CSV Diff",
      description: "Renders CSV file diffs as side-by-side tables on GitHub",
      browser_specific_settings: {
        gecko: {
          id: "github-better-csv-diff@letconst.dev",
          data_collection_permissions: {
            required: ["none"],
          },
        },
      },
      ...firefoxHostPermissions,
    };
  },
});
