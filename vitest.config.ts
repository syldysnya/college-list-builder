import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // No global `include`: the npm scripts scope each run by directory —
    //   `test`  → vitest run src    (unit + integration; the gate, key-free)
    //   `eval`  → vitest run evals  (live-model behavioral evals)
    //   `bench` → vitest run bench  (latency / cost / provider comparison)
    // so evals/ and bench/ are excluded from the default gate but still run.
    environment: "node",
  },
});
