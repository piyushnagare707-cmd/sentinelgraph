import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      // Network/orchestration layers are exercised by scripts/smoke.mjs
      // against a live server (see docs/DEMO.md); unit thresholds cover the
      // auditable deterministic core (heuristics, score, paths, schemas).
      exclude: [
        "src/lib/fetch.ts",
        "src/lib/pipeline.ts",
        "src/lib/cache.ts",
        "src/lib/ai/verdict.ts",
        "src/lib/client-storage.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
