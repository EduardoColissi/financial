import { defineConfig, devices } from "@playwright/test";

// 3006, nao 3005: o E2E sobe o proprio servidor e nao pode brigar com o
// `pnpm dev` que costuma estar aberto durante o trabalho.
const PORT = 3006;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Poucos specs, todos de fluxo critico. O mais importante deles e' o de
 * seguranca: sem cookie, nenhuma rota — pagina OU api — pode responder 200.
 *
 * A suite NAO altera nenhum arquivo de ambiente da maquina: os specs
 * autenticados entram por cookie assinado com o `AUTH_SECRET` do proprio
 * `.env.local` (ver `e2e/fixtures.ts`).
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
  // 5s nao chega: a suite roda em `next dev`, e a PRIMEIRA visita a cada rota
  // paga a compilacao sob demanda. Rodar contra build de producao nao e' opcao —
  // `APP_FAKE_TODAY` e' ignorada la', e sem congelar a data nao ha' o que
  // afirmar sobre "vence em 7 dias".
  expect: { timeout: 15_000 },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    // Espera o /login, nao a raiz: a raiz responde 307 e o Playwright poderia
    // considerar o servidor pronto antes de a rota estar compilada.
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
