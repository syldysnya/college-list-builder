import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Mirror the `@/* -> ./src/*` path alias from tsconfig.json so route tests
  // (and the App-Router route files they import) can use `@/lib/...`.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // No global `include`: the npm scripts scope each run by directory —
    //   `test`  → vitest run src    (unit + integration; the gate, key-free)
    //   `eval`  → vitest run evals  (live-model behavioral evals)
    //   `bench` → vitest run bench  (latency / cost / provider comparison)
    // so evals/ and bench/ are excluded from the default gate but still run.
    environment: "node",
  },
});
