import { type Plugin, transformWithEsbuild } from "vite";
import { defineConfig } from "wxt";

// Drops dev-only console.debug/log calls from production bundles while keeping
// console.warn/error, which the project intentionally uses to surface errors.
// WXT ignores top-level `esbuild` config from the vite() hook, so this runs as
// a Vite plugin: esbuild marks the calls pure, and minifySyntax removes them
// because their return value is unused.
function stripDebugLogs(): Plugin {
  return {
    name: "strip-debug-logs",
    apply: "build",
    async transform(code, id) {
      if (!/\.[jt]sx?$/.test(id)) return null;
      if (!code.includes("console.debug") && !code.includes("console.log")) {
        return null;
      }
      const result = await transformWithEsbuild(code, id, {
        pure: ["console.debug", "console.log"],
        minifySyntax: true,
      });
      return { code: result.code, map: result.map };
    },
  };
}

export default defineConfig({
  srcDir: "src",
  outDir: "dist",
  modules: ["@wxt-dev/auto-icons"],
  // Strip dev-only noise (console.debug/log) from production bundles while
  // keeping console.warn/error, which the project intentionally uses to
  // surface errors. esbuild's `pure` lets minification drop these calls
  // because their return value is unused; dev builds skip minify, so the
  // calls remain there for debugging.
  vite: (env) => ({
    plugins: env.mode === "production" ? [stripDebugLogs()] : [],
  }),
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
