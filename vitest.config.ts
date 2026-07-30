import { defineConfig } from "vitest/config";

// The agent's tests live under src/. The `website/` directory is a separate
// package with its own runner (`node --test`, see website/package.json), and its
// test files use the node:test API, which vitest cannot collect — without this
// scoping the root `npm test` fails on a file it was never meant to run.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "website", "reportajgo"],
  },
});
