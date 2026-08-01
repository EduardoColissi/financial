import { defineConfig, devices } from "@playwright/test";

const PORT = 3005;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Poucos specs, todos de fluxo critico. O mais importante deles e' o de
 * seguranca: sem cookie, nenhuma rota — pagina OU api — pode responder 200.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "line" : "html",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
