import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Both halves of the stack: the wizard needs FastAPI for /meta on every
  // route, so a cold checkout (or CI) must start uvicorn too. Locally an
  // already-running pair is reused; under CI a stale server is never trusted.
  webServer: [
    {
      command:
        "cd .. && .venv/bin/python -m uvicorn api:app --host 127.0.0.1 --port 8000",
      url: "http://127.0.0.1:8000/health",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: "pnpm dev",
      port: PORT,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
