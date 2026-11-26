import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "tools/*/src/**/*.test.ts"],
    // Tests that run the world for a while take over 5 s on slow CI runners.
    testTimeout: 30_000,
  },
});
