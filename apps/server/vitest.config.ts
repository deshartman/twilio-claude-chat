import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Production code uses .js extensions on relative imports (NodeNext module
    // resolution). Vite's default resolver handles these when ESM with TS,
    // but an explicit hint keeps test imports consistent with src.
    environment: "node",
  },
});
