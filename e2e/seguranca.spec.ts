import { expect, test } from "@playwright/test";
import { MES_CORRENTE, mintSessionToken } from "./fixtures";

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
  `/${MES_CORRENTE}`,
  `/${MES_CORRENTE}/lancamentos`,
  `/${MES_CORRENTE}/contas`,
  `/${MES_CORRENTE}/cartoes`,
  `/${MES_CORRENTE}/categorias`,
  `/${MES_CORRENTE}/recorrentes`,
  `/${MES_CORRENTE}/investimentos`,
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

  await page.goto(`/${MES_CORRENTE}`);
  await expect(page).toHaveURL(/\/login/);
  // Loop de redirect apareceria como a pagina nunca estabilizar. E' link, e nao
  // botao: o inicio do OAuth e' navegacao GET, sem formulario.
  await expect(page.getByRole("link", { name: /Entrar com Google/ })).toBeVisible();
});

/**
 * Cookie BEM assinado apontando para usuario que nao existe mais.
 *
 * Acontece de verdade toda vez que o seed recria o usuario com id novo — e o
 * sintoma nao e' um erro, e' um laco: `/` nao acha a linha e manda para
 * `/login`, `/login` ve' assinatura valida e manda de volta. O navegador gira
 * entre os dois ate' desistir, sem nada no log alem de dezenas de 307.
 *
 * Para verificar que este spec pega o defeito: troque `readLiveSession` por
 * `readSession` em `app/login/page.tsx` e confirme que ELE falha.
 */
test("cookie de usuario apagado cai no login, sem laco", async ({ page, context }) => {
  await context.addCookies([
    {
      name: "mc_session",
      // UUID valido que com certeza nao esta' no banco.
      value: mintSessionToken("00000000-0000-4000-8000-000000000000", new Date()),
      domain: "localhost",
      path: "/",
    },
  ]);

  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("link", { name: /Entrar com Google/ })).toBeVisible();
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

/**
 * Uma volta do Google FORJADA nao pode virar sessao.
 *
 * Afirma a propriedade de seguranca — nenhum `mc_session` emitido — e nao o
 * motivo exato da recusa: sem `GOOGLE_*` no ambiente o app para em
 * "not-configured" antes de olhar o `state`, e um spec preso a uma mensagem so'
 * rodaria em maquina ja' configurada.
 */
test("callback forjado nao cria sessao", async ({ request }) => {
  const res = await request.get("/api/auth/google/callback?code=inventado&state=inventado", {
    maxRedirects: 0,
  });

  expect(res.status()).toBe(307);
  expect(res.headers().location).toContain("/login?erro=");

  const emitidos = res
    .headersArray()
    .filter((h) => h.name.toLowerCase() === "set-cookie")
    .map((h) => h.value);
  expect(emitidos.some((v) => v.startsWith("mc_session="))).toBe(false);
});

/**
 * Este exige `GOOGLE_*` no ambiente — o CI tem valores falsos justamente para
 * ele rodar. Numa maquina sem credencial, pula em vez de falhar: o app nao esta'
 * quebrado, esta' por configurar, e um vermelho mentiroso e' pior que um pulo
 * explicado.
 */
test("o inicio do login sai para o Google, com PKCE", async ({ request }) => {
  const res = await request.get("/api/auth/google", { maxRedirects: 0 });
  const destino = res.headers().location ?? "";

  test.skip(
    destino.includes("erro=not-configured"),
    "GOOGLE_CLIENT_ID/SECRET/ALLOWED_EMAIL nao configurados neste ambiente"
  );

  expect(res.status()).toBe(307);
  expect(destino).toContain("accounts.google.com");
  // Sem PKCE, um `code` interceptado na volta seria trocavel por qualquer um.
  expect(destino).toContain("code_challenge_method=S256");
  expect(destino).toContain("response_type=code");
});

test("cookie de sessao continua barrando o painel depois de sair", async ({ page }) => {
  await page.goto(`/${MES_CORRENTE}`);
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("link", { name: /Entrar com Google/ })).toBeVisible();
});
