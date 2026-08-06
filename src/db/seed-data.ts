/**
 * Dados do design, transcritos JA' EM CENTAVOS.
 *
 * Fonte: `design/painel-financeiro-v2.html`, linhas 1011-1129.
 *
 * Nao e' copia literal. O mock tem quatro problemas que precisam ser resolvidos
 * aqui, senao o banco nasce sujo:
 *
 *  1. A MESMA obrigacao aparece em ate' tres lugares. "Notebook Dell" esta' em
 *     TX (parcelado 5/10), em RECS (dia 27) e em CARDS[0].parcelas. Igual para
 *     "Plano odontológico", "Curso de inglês", "Academia Iron", "Internet
 *     fibra", "Condomínio" e "Seguro do carro", que aparecem em BILLS e em TX.
 *     Aqui cada obrigacao vira UMA regra de recorrencia.
 *
 *  2. BILLS e RECS sao a mesma entidade vista de duas abas. O que separa e' o
 *     meio de pagamento, nao "fixa x parcelada".
 *
 *  3. As 15 transacoes de TX nao somam os `real` das 11 categorias. Os totais
 *     agregados (7.389,45) batem entre si, mas o detalhe nao fecha. O seed gera
 *     lancamentos complementares por categoria para fechar o valor exato — sem
 *     isso nao ha' baseline para comparar a tela com o design.
 *
 *  4. As compras de 29/07 e 31/07 no Nubank aparecem na fatura ja' fechada, mas
 *     o fechamento foi em 28/07 — pela regra de ciclo elas cairiam em setembro.
 *     Foram reposicionadas dentro do ciclo 29/06-28/07.
 */

export const PALETTE = [
  "oklch(0.84 0.16 158)",
  "oklch(0.76 0.13 200)",
  "oklch(0.80 0.14 128)",
  "oklch(0.82 0.15 88)",
  "oklch(0.78 0.14 45)",
  "oklch(0.76 0.14 320)",
  "oklch(0.74 0.13 265)",
  "oklch(0.80 0.13 25)",
] as const;

/** `realCents` e' o total que a categoria PRECISA somar em agosto/2026. */
export const CATEGORIES = [
  {
    name: "Moradia",
    budgetCents: 300000,
    realCents: 295990,
    color: "oklch(0.84 0.16 158)",
  },
  {
    name: "Alimentação",
    budgetCents: 140000,
    realCents: 118642,
    color: "oklch(0.82 0.15 88)",
  },
  {
    name: "Saúde",
    budgetCents: 70000,
    realCents: 57800,
    color: "oklch(0.76 0.13 200)",
  },
  {
    name: "Transporte",
    budgetCents: 70000,
    realCents: 62735,
    color: "oklch(0.74 0.13 265)",
  },
  {
    name: "Pets",
    budgetCents: 15000,
    realCents: 9800,
    color: "oklch(0.80 0.14 128)",
  },
  {
    name: "Casa e manutenção",
    budgetCents: 50000,
    realCents: 38990,
    color: "oklch(0.72 0.11 140)",
  },
  {
    name: "Lazer",
    budgetCents: 40000,
    realCents: 33138,
    color: "oklch(0.80 0.13 25)",
  },
  {
    name: "Fitness",
    budgetCents: 30000,
    realCents: 25890,
    color: "oklch(0.78 0.14 45)",
  },
  {
    name: "Assinaturas",
    budgetCents: 30000,
    realCents: 26560,
    color: "oklch(0.76 0.14 320)",
  },
  {
    name: "Vestuário",
    budgetCents: 30000,
    realCents: 25800,
    color: "oklch(0.78 0.12 350)",
  },
  {
    name: "Educação",
    budgetCents: 60000,
    realCents: 43600,
    color: "oklch(0.74 0.12 230)",
  },
] as const;

/** Categorias de sistema: nao pertencem a grupo de despesa e nao se apagam. */
export const SYSTEM_CATEGORIES = [
  { name: "Renda", kind: "income" as const, color: "oklch(0.86 0.16 158)" },
];

/**
 * Setores de investimento. O aporte aponta para um deles — nao ha' categoria de
 * aporte, porque o destino do dinheiro JA' e' o setor.
 */
export const SECTORS = [
  {
    name: "Reserva de emergência",
    color: "oklch(0.84 0.16 158)",
    sharePercent: 60,
    isEmergencyFund: true,
    annualTargetCents: 2_400_000,
  },
  {
    name: "Previdência",
    color: "oklch(0.74 0.13 265)",
    sharePercent: 25,
    isEmergencyFund: false,
    targetCents: 20_000_000,
    annualTargetCents: 1_200_000,
  },
  {
    name: "Viagem",
    color: "oklch(0.82 0.15 88)",
    sharePercent: 15,
    isEmergencyFund: false,
    targetCents: 1_500_000,
    annualTargetCents: 800_000,
  },
] as const;

export const ACCOUNTS = [
  {
    name: "Nubank · Conta",
    type: "checking" as const,
    tag: "Pix + débito",
    initials: "NU",
    color: "oklch(0.78 0.16 300)",
    balanceCents: 421055,
    includeInCashTotal: true,
  },
  {
    name: "Itaú · Conta",
    type: "checking" as const,
    tag: "débitos automáticos",
    initials: "IT",
    color: "oklch(0.82 0.15 45)",
    balanceCents: 189020,
    includeInCashTotal: true,
  },
  {
    name: "Carteira",
    type: "cash" as const,
    tag: "espécie",
    initials: "R$",
    color: "oklch(0.84 0.10 168)",
    balanceCents: 18000,
    includeInCashTotal: true,
  },
  {
    // Aparece em TX como destino do aporte, mas nao em CONTAS: e' carteira,
    // nao caixa. Fica fora do "Saldos em conta".
    name: "Corretora XP",
    type: "brokerage" as const,
    tag: "investimentos",
    initials: "XP",
    color: "oklch(0.76 0.13 200)",
    balanceCents: 0,
    includeInCashTotal: false,
  },
] as const;

export const CARDS = [
  {
    name: "Nubank Ultravioleta",
    brand: "Mastercard",
    lastFour: "4471",
    limitCents: 800000,
    closingDay: 28,
    dueDay: 5,
    color: "oklch(0.78 0.16 300)",
    paid: false,
    closedTotalCents: 284287,
  },
  {
    name: "Itaú Click",
    brand: "Visa",
    lastFour: "8820",
    limitCents: 500000,
    closingDay: 2,
    dueDay: 10,
    color: "oklch(0.82 0.15 45)",
    paid: true,
    closedTotalCents: 112040,
  },
  {
    name: "Inter Gold",
    brand: "Mastercard",
    lastFour: "1902",
    limitCents: 300000,
    closingDay: 20,
    dueDay: 27,
    color: "oklch(0.84 0.14 88)",
    paid: false,
    closedTotalCents: 41200,
  },
] as const;

/**
 * Regras de recorrencia — o resultado da deduplicacao.
 *
 * `kind: bill` = vence numa conta ou boleto (aba "Contas a pagar").
 * `kind: subscription` = cai na fatura de um cartao (aba "Assinaturas").
 * `installments` != null = parcelada, em qualquer um dos dois canais.
 *
 * `firstMonthOffset` e' a distancia, em meses, ate' o mes de referencia do seed —
 * negativo porque toda regra comecou no passado. E' deslocamento, e nao mes
 * absoluto, porque o seed segue o relogio: com `2026-05` cravado, a parcelada
 * que o design mostra como "4 de 12" viraria 5, 6, 7 de 12 conforme o tempo
 * passa, e o baseline deixaria de ser baseline.
 */
export const RECURRING = [
  // ── contas em conta/boleto (BILLS do design) ──
  {
    name: "Aluguel",
    kind: "bill",
    category: "Moradia",
    method: "pix",
    account: "Nubank · Conta",
    dueDay: 1,
    amountCents: 220000,
    firstMonthOffset: -19,
  },
  {
    name: "Plano odontológico",
    kind: "subscription",
    category: "Saúde",
    card: "Itaú Click",
    dueDay: 2,
    amountCents: 8900,
    firstMonthOffset: -3,
    installments: 12,
  },
  {
    name: "Internet fibra 600",
    kind: "bill",
    category: "Moradia",
    method: "auto_debit",
    account: "Itaú · Conta",
    dueDay: 5,
    amountCents: 11990,
    firstMonthOffset: -19,
  },
  {
    name: "Condomínio",
    kind: "bill",
    category: "Moradia",
    method: "auto_debit",
    account: "Itaú · Conta",
    dueDay: 5,
    amountCents: 64000,
    firstMonthOffset: -19,
  },
  {
    name: "Energia elétrica",
    kind: "bill",
    category: "Moradia",
    method: "boleto",
    account: "Itaú · Conta",
    dueDay: 7,
    isVariable: true,
    estimatedCents: 18740,
    firstMonthOffset: -19,
  },
  {
    name: "Academia Iron",
    kind: "bill",
    category: "Fitness",
    method: "auto_debit",
    account: "Itaú · Conta",
    dueDay: 8,
    amountCents: 12990,
    firstMonthOffset: -14,
  },
  {
    name: "Plano de saúde",
    kind: "bill",
    category: "Saúde",
    method: "auto_debit",
    account: "Itaú · Conta",
    dueDay: 10,
    amountCents: 48900,
    firstMonthOffset: -19,
  },
  {
    name: "Água e esgoto",
    kind: "bill",
    category: "Moradia",
    method: "boleto",
    account: "Itaú · Conta",
    dueDay: 15,
    isVariable: true,
    estimatedCents: 7820,
    firstMonthOffset: -19,
  },
  // Parcela em BOLETO: quebra qualquer modelo em que parcela implique cartao.
  {
    name: "Curso de inglês",
    kind: "bill",
    category: "Educação",
    method: "boleto",
    account: "Itaú · Conta",
    dueDay: 18,
    amountCents: 34000,
    firstMonthOffset: -3,
    installments: 12,
  },
  {
    name: "Gás encanado",
    kind: "bill",
    category: "Moradia",
    method: "auto_debit",
    account: "Itaú · Conta",
    dueDay: 20,
    isVariable: true,
    estimatedCents: 6240,
    firstMonthOffset: -19,
  },
  {
    name: "Celular + dados",
    kind: "subscription",
    category: "Assinaturas",
    card: "Nubank Ultravioleta",
    dueDay: 22,
    amountCents: 6990,
    firstMonthOffset: -19,
  },
  {
    name: "Seguro do carro",
    kind: "bill",
    category: "Transporte",
    method: "boleto",
    account: "Itaú · Conta",
    dueDay: 30,
    amountCents: 21460,
    firstMonthOffset: -19,
  },

  // ── assinaturas no cartao (RECS do design) ──
  {
    name: "iCloud 2 TB",
    kind: "subscription",
    category: "Assinaturas",
    card: "Itaú Click",
    dueDay: 3,
    amountCents: 4990,
    firstMonthOffset: -19,
  },
  {
    name: "Spotify Família",
    kind: "subscription",
    category: "Assinaturas",
    card: "Nubank Ultravioleta",
    dueDay: 9,
    amountCents: 3490,
    firstMonthOffset: -19,
  },
  {
    name: "Netflix Premium",
    kind: "subscription",
    category: "Assinaturas",
    card: "Nubank Ultravioleta",
    dueDay: 14,
    amountCents: 5990,
    firstMonthOffset: -19,
  },
  {
    name: "Seguro do celular",
    kind: "subscription",
    category: "Assinaturas",
    card: "Inter Gold",
    dueDay: 17,
    amountCents: 2490,
    firstMonthOffset: -19,
  },
  {
    name: "Notion + Figma",
    kind: "subscription",
    category: "Educação",
    card: "Nubank Ultravioleta",
    dueDay: 21,
    amountCents: 9600,
    firstMonthOffset: -19,
  },
  {
    name: "Tênis de corrida",
    kind: "subscription",
    category: "Fitness",
    card: "Nubank Ultravioleta",
    dueDay: 26,
    amountCents: 12990,
    firstMonthOffset: -2,
    installments: 6,
  },
  {
    name: "Notebook Dell",
    kind: "subscription",
    category: "Casa e manutenção",
    card: "Nubank Ultravioleta",
    dueDay: 27,
    amountCents: 38990,
    firstMonthOffset: -4,
    installments: 10,
  },
] as const;

export const INCOME = [
  { description: "Salário · Vega Tech", amountCents: 980000, account: "Nubank · Conta", day: 1 },
  { description: "Freela landing page", amountCents: 260000, account: "Nubank · Conta", day: 1 },
] as const;

export const CONTRIBUTION = {
  description: "Aporte mensal · corretora",
  amountCents: 260000,
  account: "Nubank · Conta",
  sector: "Reserva de emergência",
  day: 1,
} as const;

/** Lancamentos avulsos de agosto que NAO vem de regra recorrente. */
export const ONE_OFF_EXPENSES = [
  {
    description: "Ração e banho · Tofu",
    category: "Pets",
    amountCents: 9800,
    method: "debit",
    account: "Nubank · Conta",
    day: 1,
  },
  {
    description: "Mercado São Jorge",
    category: "Alimentação",
    amountCents: 41280,
    method: "credit",
    card: "Nubank Ultravioleta",
    day: 1,
  },
  {
    description: "Consulta dermatologia",
    category: "Saúde",
    amountCents: 28000,
    method: "pix",
    account: "Nubank · Conta",
    day: 1,
  },
  {
    description: "Uber · trajetos semana",
    category: "Transporte",
    amountCents: 9645,
    method: "credit",
    card: "Inter Gold",
    day: 1,
  },
  {
    description: "Restaurante Nagai",
    category: "Alimentação",
    amountCents: 18760,
    method: "credit",
    card: "Nubank Ultravioleta",
    day: 1,
  },
] as const;

/**
 * Historico do grafico de 6 meses (FLUXO do design), em centavos.
 *
 * `monthOffset` conta para tras a partir do mes de referencia do seed: -5 e' o
 * mes mais antigo da barra, -1 o mes passado. O sexto e' o corrente, que sai dos
 * lancamentos de verdade e por isso nao esta' aqui.
 */
export const CASHFLOW_HISTORY = [
  { monthOffset: -5, incomeCents: 1145000, expenseCents: 742000, contributionCents: 200000 },
  { monthOffset: -4, incomeCents: 1190000, expenseCents: 632000, contributionCents: 240000 },
  { monthOffset: -3, incomeCents: 1150000, expenseCents: 718000, contributionCents: 220000 },
  { monthOffset: -2, incomeCents: 1190000, expenseCents: 689000, contributionCents: 240000 },
  { monthOffset: -1, incomeCents: 1240000, expenseCents: 603800, contributionCents: 260000 },
] as const;

/** Totais que o seed TEM que reproduzir. Sao o criterio de aceite do passo. */
export const EXPECTED_TOTALS = {
  expenseCents: 738945,
  incomeCents: 1240000,
  contributionCents: 260000,
  nubankClosedCents: 284287,
} as const;
