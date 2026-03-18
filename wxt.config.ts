import { defineConfig } from "wxt";

export default defineConfig({
  srcDir: "src",
  outDir: "dist",
  manifest: {
    name: "GitHub Better CSV Diff",
    description: "Renders CSV file diffs as side-by-side tables on GitHub",
  },
});
