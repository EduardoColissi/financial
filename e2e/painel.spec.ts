import { expect, test } from "@playwright/test";
import { STORAGE_STATE } from "./fixtures";

/**
 * Fluxo do dono: navegar e lancar.
 *
 * Entra por cookie assinado (ver `fixtures.ts`), nao pelo formulario — o que
 * ainda exercita `verifySessionToken`, o `proxy.ts` e o `requireSession()`.
 *
 * Roda contra o seed, que reproduz os numeros do design.
 */
test.use({ storageState: STORAGE_STATE });

test.beforeEach(async ({ page }) => {
  await page.goto("/2026-08");
  await expect(page).toHaveURL(/\/2026-08$/);
});

test("as sete abas abrem com dado", async ({ page }) => {
  const abas: Array<[string, string, RegExp]> = [
    ["Lançamentos", "lancamentos", /Lançamentos do mês/],
    ["Contas a pagar", "contas", /calendário|vencimento/i],
    ["Cartões", "cartoes", /fatura/i],
    ["Assinaturas", "recorrentes", /Cobranças recorrentes/],
    ["Categorias", "categorias", /orçamento|categoria/i],
    ["Investimentos", "investimentos", /carteira|alocação|rendimento/i],
  ];

  for (const [label, slug, esperado] of abas) {
    await page.getByRole("link", { name: new RegExp(`^${label}`) }).click();
    // A URL primeiro: em `next dev` a rota compila na primeira visita, e
    // afirmar o conteudo antes disso falha por lentidao, nao por defeito.
    await expect(page).toHaveURL(new RegExp(`/2026-08/${slug}$`));
    await expect(page.getByText(esperado).first()).toBeVisible();
  }
});

test("navegar de mes muda a URL e mantem a aba", async ({ page }) => {
  await page.getByRole("link", { name: /^Cartões/ }).click();
  await expect(page).toHaveURL(/\/2026-08\/cartoes$/);

  await page.getByRole("link", { name: "Mês anterior" }).click();
  await expect(page).toHaveURL(/\/2026-07\/cartoes/);

  await page.getByRole("link", { name: "Próximo mês" }).click();
  await expect(page).toHaveURL(/\/2026-08\/cartoes/);
});

test("o modal abre pela URL e o botao voltar fecha", async ({ page }) => {
  await page.getByRole("link", { name: /Novo lançamento/ }).click();
  await expect(page).toHaveURL(/novo=1/);
  await expect(page.getByRole("heading", { name: "Novo lançamento" })).toBeVisible();

  await page.goBack();
  await expect(page).not.toHaveURL(/novo=1/);
  await expect(page.getByRole("heading", { name: "Novo lançamento" })).toBeHidden();
});

test("criar lancamento a' vista move os totais do mes", async ({ page }) => {
  await page.getByRole("link", { name: /^Lançamentos/ }).click();
  await expect(page).toHaveURL(/\/2026-08\/lancamentos$/);

  // `saídas` sozinho casa tambem com o subtitulo do header e com a legenda do
  // grafico da visao geral; o resumo e' a linha que traz os dois valores.
  const resumo = page.getByText(/^entradas .* · saídas/);
  const antes = await resumo.textContent();

  await page.getByRole("link", { name: /Novo lançamento/ }).click();
  await page.getByLabel("Valor").fill("199,90");
  await page.getByLabel("Descrição").fill("Lançamento do E2E");
  await page.getByRole("button", { name: "Salvar lançamento" }).click();

  await expect(page).toHaveURL(/\/2026-08\/lancamentos$/);
  await expect(page.getByText("Lançamento do E2E")).toBeVisible();
  // Os agregados so' mudam no round-trip do revalidate — e' deliberado.
  await expect(resumo).not.toHaveText(antes ?? "");
});

test("parcelado vira parcelamento, nao N lancamentos soltos", async ({ page }) => {
  await page.getByRole("link", { name: /Novo lançamento/ }).click();
  await page.getByLabel("Valor").fill("100,00");
  await page.getByLabel("Descrição").fill("Parcelado do E2E");
  await page.getByRole("button", { name: "Crédito", exact: true }).click();
  await page.getByLabel("Parcelas").fill("3");

  // O resto vai para a primeira parcela, e a previa DIZ isso — o design promete
  // "3× R$ 33,33" e grava outro valor.
  await expect(page.getByText(/1ª de R\$ 33,34/)).toBeVisible();

  await page.getByRole("button", { name: "Salvar lançamento" }).click();

  // Parcelamento nao e' lancamento avulso: cai na fatura do cartao.
  await expect(page).toHaveURL(/\/2026-08\/recorrentes$/);
  await expect(page.getByText("Parcelado do E2E")).toBeVisible();
  await expect(page.getByText("1 de 3")).toBeVisible();
});

test("sair apaga a sessao", async ({ page }) => {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/2026-08");
  await expect(page).toHaveURL(/\/login/);
});
