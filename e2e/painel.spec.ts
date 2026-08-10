import { expect, test } from "@playwright/test";
import { MES_ANTERIOR, MES_CORRENTE, STORAGE_STATE } from "./fixtures";

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
  await page.goto(`/${MES_CORRENTE}`);
  await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}$`));
});

test("as abas do mes abrem com dado", async ({ page }) => {
  const abas: Array<[string, string, RegExp]> = [
    ["Lançamentos", "lancamentos", /Lançamentos do mês/],
    ["Contas a pagar", "contas", /calendário|vencimento/i],
    ["Cartões", "cartoes", /fatura/i],
    ["Assinaturas", "recorrentes", /Cobranças recorrentes/],
    ["Categorias", "categorias", /orçamento|categoria/i],
    ["Investimentos", "investimentos", /sobra|setor/i],
  ];

  for (const [label, slug, esperado] of abas) {
    await page.getByRole("link", { name: new RegExp(`^${label}`) }).click();
    // A URL primeiro: em `next dev` a rota compila na primeira visita, e
    // afirmar o conteudo antes disso falha por lentidao, nao por defeito.
    await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}/${slug}$`));
    await expect(page.getByText(esperado).first()).toBeVisible();
  }
});

test("navegar de mes muda a URL e mantem a aba", async ({ page }) => {
  await page.getByRole("link", { name: /^Cartões/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}/cartoes$`));

  await page.getByRole("link", { name: "Mês anterior" }).click();
  await expect(page).toHaveURL(new RegExp(`/${MES_ANTERIOR}/cartoes`));

  await page.getByRole("link", { name: "Próximo mês" }).click();
  await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}/cartoes`));
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
  await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}/lancamentos$`));

  // `saídas` sozinho casa tambem com o subtitulo do header e com a legenda do
  // grafico da visao geral; o resumo e' a linha que traz os dois valores.
  const resumo = page.getByText(/^entradas .* · saídas/);
  const antes = await resumo.textContent();

  await page.getByRole("link", { name: /Novo lançamento/ }).click();
  await page.getByLabel("Valor").fill("199,90");
  await page.getByLabel("Descrição").fill("Lançamento do E2E");
  await page.getByRole("button", { name: "Salvar lançamento" }).click();

  await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}/lancamentos$`));
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

  /*
   * Parcelamento nao e' lancamento avulso: cai na fatura do cartao.
   *
   * O mes NAO e' cravado de proposito. A aba lista por fatura, e a parcela de
   * hoje pertence a' fatura do mes seguinte sempre que a compra vem depois do
   * fechamento — qual dos dois depende do ciclo do cartao que o modal escolheu.
   * O que este spec garante e' que o usuario aterrissa onde a parcela ESTA'.
   */
  await expect(page).toHaveURL(/\/\d{4}-\d{2}\/recorrentes$/);
  await expect(page.getByText("Parcelado do E2E")).toBeVisible();
  await expect(page.getByText("1 de 3")).toBeVisible();
});

/**
 * A invariante do painel, exercitada de ponta a ponta.
 *
 * "Em conta" e' o dinheiro que existe; "sobra" ja' desconta o que falta pagar.
 * Pagar uma conta tem que derrubar o PRIMEIRO e deixar o SEGUNDO parado — e' o
 * que prova que os dois numeros significam o que dizem.
 *
 * Para verificar que este spec pega o defeito: faca `payCharge` gravar o
 * pagamento sem criar o lancamento (ou o contrario) e confirme que ELE falha.
 */
test("pagar uma conta derruba o em conta e nao mexe na sobra", async ({ page }) => {
  // `data-kpi`, e nao texto: "Em conta" tambem rotula o rodape da barra lateral,
  // e casar por texto pegava aquele — comparando um numero que nao muda.
  const valor = (kpi: string) => page.locator(`[data-kpi="${kpi}"]`).innerText();

  const emContaAntes = await valor("em-conta");
  const sobraAntes = await valor("sobra");

  await page.getByRole("link", { name: /^Contas a pagar/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}/contas$`));

  // A primeira conta em aberto que NAO cai em fatura.
  const pagar = page.getByRole("button", { name: "Pagar" }).first();
  await pagar.click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("button", { name: "Desfazer" }).first()).toBeVisible();

  await page.getByRole("link", { name: /^Visão geral/ }).click();
  const emContaDepois = await valor("em-conta");
  const sobraDepois = await valor("sobra");

  expect(emContaDepois).not.toBe(emContaAntes); // saiu do caixa
  expect(sobraDepois).toBe(sobraAntes); // o compromisso ja' estava contado
});

test("editar um lancamento corrige o valor e o total do mes", async ({ page }) => {
  await page.getByRole("link", { name: /^Lançamentos/ }).click();

  const resumo = page.getByText(/^entradas .* · saídas/);
  const antes = await resumo.textContent();

  const linha = page.locator("tbody tr").first();
  const descricao = await linha.locator("td").nth(1).innerText();
  await linha.getByRole("link", { name: "Editar" }).click();

  await expect(page.getByRole("heading", { name: "Editar lançamento" })).toBeVisible();
  const valor = page.getByLabel("Valor");
  await valor.fill("");
  await valor.pressSequentially("7777");
  await expect(valor).toHaveValue("77,77");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();

  // O modal fecha sozinho e a linha volta com o valor novo.
  await expect(page.getByRole("heading", { name: "Editar lançamento" })).toBeHidden();
  await expect(page.locator("tbody tr").filter({ hasText: descricao }).first()).toContainText(
    "77,77"
  );
  await expect(resumo).not.toHaveText(antes ?? "");
});

/**
 * A invariante da exclusao, e a razao de ela nao ser um `DELETE` e pronto.
 *
 * Apagar o pagamento de uma conta NAO apaga a conta: devolve ela para o aberto e
 * o dinheiro para o caixa. As chaves estrangeiras sao `set null`, entao um
 * delete cru deixaria a cobranca marcada como paga apontando para nada — a tela
 * mostraria a conta quitada com o dinheiro de volta, e o banco nao reclamaria.
 *
 * Para verificar que este spec pega o defeito: faca `deleteEntry` apagar a linha
 * sem chamar `reopenCharge` e confirme que ELE falha.
 */
test("excluir o pagamento de uma conta devolve ela para o aberto", async ({ page }) => {
  await page.getByRole("link", { name: /^Contas a pagar/ }).click();

  await page.getByRole("button", { name: "Pagar" }).first().click();
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("button", { name: "Desfazer" }).first()).toBeVisible();

  const abertasDepoisDePagar = await page.getByRole("button", { name: "Pagar" }).count();

  await page.getByRole("link", { name: /^Lançamentos/ }).click();
  const linha = page.locator("tbody tr").first();
  await linha.getByRole("button", { name: "Excluir" }).click();

  // A confirmacao diz o efeito, que e' o contrario do esperado.
  const aviso = page.getByRole("alert").filter({ hasText: "Apagar" });
  await expect(aviso).toContainText("volta para as contas a pagar");
  await aviso.getByRole("button", { name: "Apagar" }).click();

  await page.getByRole("link", { name: /^Contas a pagar/ }).click();
  await expect(page.getByRole("button", { name: "Pagar" })).toHaveCount(abertasDepoisDePagar + 1);
});

/**
 * Cadastro de categoria pela tela, do formulario ao banco.
 *
 * Cobre os dois tipos porque o formulario MUDA entre eles: gasto tem orcamento,
 * receita nao. Uma regressao que fizesse o campo aparecer para receita passaria
 * despercebida se o spec so' testasse um dos dois.
 */
test("cadastrar categoria de gasto e de receita", async ({ page }) => {
  await page.getByRole("link", { name: /^Cadastros/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}/ajustes$`));

  // ── gasto, com orçamento ──
  await page.getByRole("button", { name: "Nova categoria" }).click();
  const form = page.locator("form").filter({ hasText: "Criar categoria" });
  await form.getByLabel("Nome").fill("Uber do E2E");
  await expect(form.getByLabel("Orçamento mensal")).toBeVisible();
  await form.getByLabel("Orçamento mensal").fill("250,00");
  await form.getByRole("button", { name: "Criar categoria" }).click();

  const gasto = page.locator("li").filter({ hasText: "Uber do E2E" });
  await expect(gasto).toContainText("Gasto");
  await expect(gasto).toContainText("R$ 250,00");

  // ── receita: o campo de orçamento tem que SUMIR ──
  await page.getByRole("button", { name: "Nova categoria" }).click();
  const form2 = page.locator("form").filter({ hasText: "Criar categoria" });
  await form2.getByLabel("Nome").fill("Salário do E2E");
  await form2.getByLabel("Tipo").selectOption("income");
  await expect(form2.getByLabel("Orçamento mensal")).toHaveCount(0);
  await form2.getByRole("button", { name: "Criar categoria" }).click();

  const receita = page.locator("li").filter({ hasText: "Salário do E2E" });
  await expect(receita).toContainText("Receita");
  await expect(receita).toContainText("sem orçamento");
});

/**
 * O campo de dinheiro se comporta como o do banco.
 *
 * Digitar tecla a tecla e' o unico jeito de pegar o defeito classico da
 * mascara: o separador que ela acabou de inserir voltar como digito, fazendo o
 * valor crescer sozinho. `fill()` entrega o texto de uma vez e passaria mesmo
 * com a mascara quebrada.
 */
test("no campo de valor os digitos entram pela direita", async ({ page }) => {
  await page.getByRole("link", { name: /Novo lançamento/ }).click();
  const valor = page.getByLabel("Valor");

  await valor.pressSequentially("1");
  await expect(valor).toHaveValue("0,01");

  await valor.pressSequentially("2");
  await expect(valor).toHaveValue("0,12");

  await valor.pressSequentially("99");
  await expect(valor).toHaveValue("12,99");

  // Passar do milhar e' onde o ponto aparece — e onde ele voltaria como digito.
  await valor.pressSequentially("00");
  await expect(valor).toHaveValue("1.299,00");

  // E o que a previa promete e' o que a mascara mostra.
  await expect(page.getByText(/R\$ 1\.299,00/).first()).toBeVisible();
});

/**
 * Aporte escolhe SETOR, e o setor soma o que entrou.
 *
 * O caminho inteiro num spec so' porque ele e' a mudanca: nao ha' mais botao de
 * "aportar a sobra" nem categoria de aporte — quem move dinheiro para o
 * investimento e' o lancamento, e o acumulado do setor e' a soma deles.
 */
test("aporte escolhe setor e soma no acumulado dele", async ({ page }) => {
  await page.getByRole("link", { name: /^Investimentos/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}/investimentos$`));

  // O botao que aportava sozinho saiu: a fatia agora so' sugere.
  await expect(
    page.getByRole("button", { name: /Aportar a sobra|Reconfirmar aporte/ })
  ).toHaveCount(0);

  const setor = page.locator("h3, h2").filter({ hasText: "Reserva de emergência" }).first();
  await expect(setor).toBeVisible();

  await page.getByRole("link", { name: /Novo lançamento/ }).click();
  await page.getByRole("button", { name: "Aporte", exact: true }).click();

  // O campo de destino vira "Setor" — categoria de aporte nao existe mais.
  await expect(page.getByRole("group", { name: "Setor" })).toBeVisible();
  await page.getByRole("button", { name: "Reserva de emergência" }).click();

  await page.getByLabel("Valor").pressSequentially("15000");
  await page.getByLabel("Descrição").fill("Aporte do E2E");
  await page.getByRole("button", { name: "Salvar lançamento" }).click();

  await expect(page.getByText("Aporte do E2E")).toBeVisible();

  await page.getByRole("link", { name: /^Investimentos/ }).click();
  const cartao = page.locator("section, div").filter({ hasText: "Reserva de emergência" }).last();
  await expect(cartao).toContainText("150,00");
});

/**
 * A cor deixou de ser oito opcoes fixas.
 *
 * O seletor nativo grava hex, e o hex tem que chegar ate' o ponto colorido da
 * lista — e' o caminho inteiro (formulario, validacao, banco, render). Um spec
 * que so' olhasse o formulario passaria mesmo com o validador recusando hex.
 */
test("da' para escolher uma cor fora da paleta", async ({ page }) => {
  await page.getByRole("link", { name: /^Cadastros/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}/ajustes$`));

  await page.getByRole("button", { name: "Nova categoria" }).click();
  const form = page.locator("form").filter({ hasText: "Criar categoria" });
  await form.getByLabel("Nome").fill("Cor livre do E2E");

  await form.getByLabel("Escolher outra cor").fill("#a1b2c3");
  // Mexer no seletor tem que marcar a nona casa sozinho — sem isso o formulario
  // enviaria o preset que estava marcado antes.
  await expect(form.getByRole("radio", { name: "Cor personalizada" })).toBeChecked();

  await form.getByRole("button", { name: "Criar categoria" }).click();

  // O ponto colorido e' o unico elemento da linha com cor inline — e o teste e'
  // sobre a cor RENDERIZADA, nao sobre o que foi gravado.
  const linha = page.locator("li").filter({ hasText: "Cor livre do E2E" });
  await expect(linha).toBeVisible();
  await expect(linha.locator("span[style]").first()).toHaveCSS(
    "background-color",
    "rgb(161, 178, 195)"
  );
});

/**
 * O cartao nao pergunta de qual conta a fatura sai.
 *
 * O dinheiro e' um so': a conta registra ONDE ele entrou, nao de qual pote a
 * fatura sai. Este spec falha se o campo voltar ao formulario.
 */
test("cadastrar cartao nao pede conta de pagamento", async ({ page }) => {
  await page.getByRole("link", { name: /^Cadastros/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}/ajustes$`));

  await page.getByRole("button", { name: "Novo cartão" }).click();
  const form = page.locator("form").filter({ hasText: "Criar cartão" });

  await expect(form.getByLabel(/Paga desta conta/)).toHaveCount(0);

  await form.getByLabel("Nome").fill("Cartão do E2E");
  await form.getByLabel("Bandeira").fill("Visa");
  await form.getByLabel("Limite").pressSequentially("500000");
  await expect(form.getByLabel("Limite")).toHaveValue("5.000,00");
  await form.getByRole("button", { name: "Criar cartão" }).click();

  const linha = page.locator("li").filter({ hasText: "Cartão do E2E" });
  await expect(linha).toContainText("R$ 5.000,00");
});

/**
 * Exclusao e' definitiva e cascateia — a confirmacao tem que DIZER o estrago.
 *
 * "Nubank · Conta" do seed carrega 17 dos 20 lancamentos do mes. Um dialogo
 * generico ("tem certeza?") esconderia isso; o numero, nao. Este spec falha se
 * alguem trocar o banner por uma confirmacao muda, ou se o `cascade` voltar a
 * ser `restrict` (a conta continuaria na lista depois do clique).
 *
 * Fica por ultimo entre os specs autenticados de propriedade: ele apaga dado do
 * seed, e os anteriores contam com ele presente.
 */
test("excluir conta avisa quantos lancamentos vao junto", async ({ page }) => {
  await page.getByRole("link", { name: /^Cadastros/ }).click();
  await expect(page).toHaveURL(new RegExp(`/${MES_CORRENTE}/ajustes$`));

  const linha = page.locator("li").filter({ hasText: "Nubank · Conta" }).first();
  await linha.getByRole("button", { name: "Excluir" }).click();

  // O banner precisa nomear a conta e contar os dependentes.
  const aviso = page.getByRole("alert").filter({ hasText: "Apagar" });
  await expect(aviso).toContainText("Nubank · Conta");
  await expect(aviso).toContainText(/\d+ lançamentos/);

  await aviso.getByRole("button", { name: "Apagar definitivamente" }).click();

  // Sumiu de verdade — nao arquivada, nao escondida.
  await expect(page.getByText("Nubank · Conta")).toHaveCount(0);
});

test("sair apaga a sessao", async ({ page }) => {
  await page.getByRole("button", { name: "Sair" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto(`/${MES_CORRENTE}`);
  await expect(page).toHaveURL(/\/login/);
});
