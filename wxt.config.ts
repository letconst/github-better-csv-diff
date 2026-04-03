import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  outDir: "dist",
  modules: ["@wxt-dev/auto-icons"],
  autoIcons: {
    baseIconPath: "assets/icon.svg",
  },
  manifest: {
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
  },
});
