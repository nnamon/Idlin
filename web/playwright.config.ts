import { defineConfig, devices } from "@playwright/test";

// Deterministic UI capture (AGENTS.md §6), Track 1: the React overlay. Headless
// Chromium, a fixed viewport and device scale, dark scheme, animations off — so
// the only thing that moves a pixel is an intentional UI change. The overlay
// renders purely from injected store state; no clock stepping is needed here
// (that's the 3D-scene track).
const PORT = 5180;

export default defineConfig({
  testDir: "harness",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    // Kill CSS transitions/animations so a frame is a frame.
    contextOptions: { reducedMotion: "reduce" },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    },
  ],
  // Serve the fixture pages from Vite's dev server. The production build
  // (`vite build`) only inputs index.html, so harness/fixture.html ships
  // nowhere — this is dev/test-only.
  webServer: {
    command: `node_modules/.bin/vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/harness/fixture.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
