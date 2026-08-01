import { expect, test } from "@playwright/test";

/**
 * O spec que nao pode faltar.
 *
 * Dado financeiro pessoal numa URL publica. O erro classico e' proteger as
 * paginas e esquecer `/api/*` no matcher — as telas pedem senha e o JSON com o
 * extrato inteiro responde 200 para qualquer um.
 *
 * Para verificar que ele realmente pega o erro: tire `api` do matcher em
 * `src/proxy.ts` e confirme que ESTE arquivo falha.
 */

test.use({ storageState: { cookies: [], origins: [] } });

const ROTAS_DE_PAGINA = [
  "/",
  "/2026-08",
  "/2026-08/lancamentos",
  "/2026-08/contas",
  "/2026-08/cartoes",
  "/2026-08/categorias",
  "/2026-08/recorrentes",
  "/2026-08/investimentos",
];

test("nenhuma pagina responde sem sessao", async ({ request }) => {
  for (const rota of ROTAS_DE_PAGINA) {
    const res = await request.get(rota, { maxRedirects: 0 });
    expect(res.status(), `${rota} devia redirecionar para o login`).toBe(307);
    expect(res.headers().location).toContain("/login");
  }
});

test("api responde 401 em JSON, nunca 200 nem HTML", async ({ request }) => {
  for (const rota of ["/api/qualquer-coisa", "/api/transactions", "/api/cron"]) {
    const res = await request.get(rota, { maxRedirects: 0 });

    expect(res.status(), `${rota} devia ser 401`).toBe(401);
    // Devolver o HTML do login para um fetch faria o cliente tentar
    // interpretar uma pagina como dados — falha confusa e tardia.
    expect(res.headers()["content-type"]).toContain("application/json");
    expect(await res.json()).toEqual({ error: "unauthorized" });
  }
});

test("o cron recusa chamada sem o segredo", async ({ request }) => {
  const semNada = await request.get("/api/cron/daily", { maxRedirects: 0 });
  expect(semNada.status()).toBe(401);

  const comSegredoErrado = await request.get("/api/cron/daily", {
    headers: { authorization: "Bearer errado" },
    maxRedirects: 0,
  });
  expect(comSegredoErrado.status()).toBe(401);
});

test("cookie adulterado nao entra e nao entra em loop", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "mc_session",
      value: "payloadfalso.assinaturafalsa",
      domain: "localhost",
      path: "/",
    },
  ]);

  await page.goto("/2026-08");
  await expect(page).toHaveURL(/\/login/);
  // Loop de redirect apareceria como a pagina nunca estabilizar.
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
});

test("o login e' publico e nao vai para indice de busca", async ({ request }) => {
  const login = await request.get("/login");
  expect(login.status()).toBe(200);

  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Disallow: /");

  const headers = login.headers();
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-robots-tag"]).toContain("noindex");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-content-type-options"]).toBe("nosniff");
});

test("passphrase errada nao cria sessao", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Passphrase").fill("isto nao e a passphrase certa, garantido");
  await page.getByRole("button", { name: "Entrar" }).click();

  // Mensagem unica de proposito: distinguir "senha errada" de qualquer outra
  // coisa entregaria informacao de graca a quem esta' tentando.
  // `.filter` porque o Next mantem um <div role="alert"> vazio para anunciar
  // troca de rota — sem isso o seletor casa com dois elementos.
  await expect(
    page.getByRole("alert").filter({ hasText: "Passphrase" })
  ).toHaveText("Passphrase incorreta.");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/2026-08");
  await expect(page).toHaveURL(/\/login/);
});
