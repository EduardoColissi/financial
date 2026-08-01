import { expect, test } from "@playwright/test";

/**
 * Smoke minimo: prova que a app sobe e responde.
 *
 * Existe porque build verde nao prova que a aplicacao roda — os specs de fluxo
 * critico (gate de acesso, criar lancamento, navegar mes) entram no passo 23.
 */
test("a aplicacao responde", async ({ page }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
});
