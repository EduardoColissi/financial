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

export const GROUPS = [
  { name: "Essencial", color: "oklch(0.84 0.16 158)", sortOrder: 0 },
  { name: "Qualidade de vida", color: "oklch(0.80 0.14 88)", sortOrder: 1 },
  { name: "Desenvolvimento", color: "oklch(0.74 0.12 230)", sortOrder: 2 },
] as const;

/** `realCents` e' o total que a categoria PRECISA somar em agosto/2026. */
export const CATEGORIES = [
  {
    name: "Moradia",
    group: "Essencial",
    budgetCents: 300000,
    realCents: 295990,
    color: "oklch(0.84 0.16 158)",
  },
  {
    name: "Alimentação",
    group: "Essencial",
    budgetCents: 140000,
    realCents: 118642,
    color: "oklch(0.82 0.15 88)",
  },
  {
    name: "Saúde",
    group: "Essencial",
    budgetCents: 70000,
    realCents: 57800,
    color: "oklch(0.76 0.13 200)",
  },
  {
    name: "Transporte",
    group: "Essencial",
    budgetCents: 70000,
    realCents: 62735,
    color: "oklch(0.74 0.13 265)",
  },
  {
    name: "Pets",
    group: "Essencial",
    budgetCents: 15000,
    realCents: 9800,
    color: "oklch(0.80 0.14 128)",
  },
  {
    name: "Casa e manutenção",
    group: "Essencial",
    budgetCents: 50000,
    realCents: 38990,
    color: "oklch(0.72 0.11 140)",
  },
  {
    name: "Lazer",
    group: "Qualidade de vida",
    budgetCents: 40000,
    realCents: 33138,
    color: "oklch(0.80 0.13 25)",
  },
  {
    name: "Fitness",
    group: "Qualidade de vida",
    budgetCents: 30000,
    realCents: 25890,
    color: "oklch(0.78 0.14 45)",
  },
  {
    name: "Assinaturas",
    group: "Qualidade de vida",
    budgetCents: 30000,
    realCents: 26560,
    color: "oklch(0.76 0.14 320)",
  },
  {
    name: "Vestuário",
    group: "Qualidade de vida",
    budgetCents: 30000,
    realCents: 25800,
    color: "oklch(0.78 0.12 350)",
  },
  {
    name: "Educação",
    group: "Desenvolvimento",
    budgetCents: 60000,
    realCents: 43600,
    color: "oklch(0.74 0.12 230)",
  },
] as const;

/** Categorias de sistema: nao pertencem a grupo de despesa e nao se apagam. */
export const SYSTEM_CATEGORIES = [
  { name: "Renda", kind: "income" as const, color: "oklch(0.86 0.16 158)" },
  { name: "Aporte", kind: "investment" as const, color: "oklch(0.74 0.13 210)" },
];

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
    autopay: false,
    firstMonth: "2025-01",
  },
  {
    name: "Plano odontológico",
    kind: "subscription",
    category: "Saúde",
    card: "Itaú Click",
    dueDay: 2,
    amountCents: 8900,
    autopay: true,
    firstMonth: "2026-05",
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
    autopay: true,
    firstMonth: "2025-01",
  },
  {
    name: "Condomínio",
    kind: "bill",
    category: "Moradia",
    method: "auto_debit",
    account: "Itaú · Conta",
    dueDay: 5,
    amountCents: 64000,
    autopay: true,
    firstMonth: "2025-01",
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
    autopay: false,
    firstMonth: "2025-01",
  },
  {
    name: "Academia Iron",
    kind: "bill",
    category: "Fitness",
    method: "auto_debit",
    account: "Itaú · Conta",
    dueDay: 8,
    amountCents: 12990,
    autopay: true,
    firstMonth: "2025-06",
  },
  {
    name: "Plano de saúde",
    kind: "bill",
    category: "Saúde",
    method: "auto_debit",
    account: "Itaú · Conta",
    dueDay: 10,
    amountCents: 48900,
    autopay: true,
    firstMonth: "2025-01",
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
    autopay: false,
    firstMonth: "2025-01",
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
    autopay: false,
    firstMonth: "2026-05",
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
    autopay: true,
    firstMonth: "2025-01",
  },
  {
    name: "Celular + dados",
    kind: "subscription",
    category: "Assinaturas",
    card: "Nubank Ultravioleta",
    dueDay: 22,
    amountCents: 6990,
    autopay: true,
    firstMonth: "2025-01",
  },
  {
    name: "Seguro do carro",
    kind: "bill",
    category: "Transporte",
    method: "boleto",
    account: "Itaú · Conta",
    dueDay: 30,
    amountCents: 21460,
    autopay: false,
    firstMonth: "2025-01",
  },

  // ── assinaturas no cartao (RECS do design) ──
  {
    name: "iCloud 2 TB",
    kind: "subscription",
    category: "Assinaturas",
    card: "Itaú Click",
    dueDay: 3,
    amountCents: 4990,
    autopay: true,
    firstMonth: "2025-01",
  },
  {
    name: "Spotify Família",
    kind: "subscription",
    category: "Assinaturas",
    card: "Nubank Ultravioleta",
    dueDay: 9,
    amountCents: 3490,
    autopay: true,
    firstMonth: "2025-01",
  },
  {
    name: "Netflix Premium",
    kind: "subscription",
    category: "Assinaturas",
    card: "Nubank Ultravioleta",
    dueDay: 14,
    amountCents: 5990,
    autopay: true,
    firstMonth: "2025-01",
  },
  {
    name: "Seguro do celular",
    kind: "subscription",
    category: "Assinaturas",
    card: "Inter Gold",
    dueDay: 17,
    amountCents: 2490,
    autopay: true,
    firstMonth: "2025-01",
  },
  {
    name: "Notion + Figma",
    kind: "subscription",
    category: "Educação",
    card: "Nubank Ultravioleta",
    dueDay: 21,
    amountCents: 9600,
    autopay: true,
    firstMonth: "2025-01",
  },
  {
    name: "Tênis de corrida",
    kind: "subscription",
    category: "Fitness",
    card: "Nubank Ultravioleta",
    dueDay: 26,
    amountCents: 12990,
    autopay: false,
    firstMonth: "2026-06",
    installments: 6,
  },
  {
    name: "Notebook Dell",
    kind: "subscription",
    category: "Casa e manutenção",
    card: "Nubank Ultravioleta",
    dueDay: 27,
    amountCents: 38990,
    autopay: false,
    firstMonth: "2026-04",
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

export const SEGMENTS = [
  { name: "Ações", color: "oklch(0.84 0.16 158)", targetPercent: 30 },
  { name: "Fundos imobiliários", color: "oklch(0.76 0.13 200)", targetPercent: 15 },
  { name: "Renda fixa", color: "oklch(0.82 0.15 88)", targetPercent: 20 },
  { name: "Reserva · caixinhas", color: "oklch(0.80 0.14 128)", targetPercent: 25 },
  { name: "Internacional", color: "oklch(0.76 0.14 320)", targetPercent: 5 },
  { name: "Cripto", color: "oklch(0.80 0.13 25)", targetPercent: 5 },
] as const;

/** aplicado / saldo / rendimento do mes / proventos — tudo em centavos. */
export const ASSETS = [
  {
    name: "PETR4 · Petrobras PN",
    ticker: "PETR4",
    segment: "Ações",
    investedCents: 680000,
    valueCents: 742000,
    monthCents: 14800,
    dividendCents: 9600,
    detail: "340 cotas · DY 11,2%",
  },
  {
    name: "ITSA4 · Itaúsa",
    ticker: "ITSA4",
    segment: "Ações",
    investedCents: 520000,
    valueCents: 561000,
    monthCents: 9600,
    dividendCents: 4200,
    detail: "520 cotas · DY 6,4%",
  },
  {
    name: "BBSE3 · BB Seguridade",
    ticker: "BBSE3",
    segment: "Ações",
    investedCents: 340000,
    valueCents: 368000,
    monthCents: 6200,
    dividendCents: 3800,
    detail: "96 cotas · DY 8,1%",
  },
  {
    name: "WEGE3 · WEG",
    ticker: "WEGE3",
    segment: "Ações",
    investedCents: 290000,
    valueCents: 317000,
    monthCents: 4400,
    dividendCents: 800,
    detail: "58 cotas · DY 1,1%",
  },
  {
    name: "MXRF11 · Maxi Renda",
    ticker: "MXRF11",
    segment: "Fundos imobiliários",
    investedCents: 360000,
    valueCents: 379000,
    monthCents: 3400,
    dividendCents: 3400,
    detail: "372 cotas · rende mensal",
  },
  {
    name: "HGLG11 · CSHG Logística",
    ticker: "HGLG11",
    segment: "Fundos imobiliários",
    investedCents: 320000,
    valueCents: 341000,
    monthCents: 2900,
    dividendCents: 2900,
    detail: "21 cotas · galpões",
  },
  {
    name: "KNCR11 · Kinea Rendimentos",
    ticker: "KNCR11",
    segment: "Fundos imobiliários",
    investedCents: 180000,
    valueCents: 192000,
    monthCents: 1600,
    dividendCents: 1600,
    detail: "18 cotas · CRI CDI",
  },
  {
    name: "Tesouro IPCA+ 2035",
    segment: "Renda fixa",
    investedCents: 820000,
    valueCents: 914000,
    monthCents: 7800,
    dividendCents: 0,
    detail: "IPCA + 6,12% a.a.",
  },
  {
    name: "CDB Inter · 112% CDI",
    segment: "Renda fixa",
    investedCents: 540000,
    valueCents: 618000,
    monthCents: 5200,
    dividendCents: 0,
    detail: "vence 03/2028 · D+0",
  },
  {
    name: "Caixinha Nubank · 100% CDI",
    segment: "Reserva · caixinhas",
    investedCents: 980000,
    valueCents: 1024000,
    monthCents: 8400,
    dividendCents: 0,
    detail: "liquidez imediata",
  },
  {
    name: "Caixinha Turbo · 110% CDI",
    segment: "Reserva · caixinhas",
    investedCents: 760000,
    valueCents: 816000,
    monthCents: 7100,
    dividendCents: 0,
    detail: "resgate em D+1",
  },
  {
    name: "IVVB11 · S&P 500",
    ticker: "IVVB11",
    segment: "Internacional",
    investedCents: 300000,
    valueCents: 346000,
    monthCents: 5800,
    dividendCents: 0,
    detail: "18 cotas · dólar embutido",
  },
  {
    name: "Bitcoin",
    segment: "Cripto",
    investedCents: 140000,
    valueCents: 178000,
    monthCents: -4200,
    dividendCents: 0,
    detail: "0,0092 BTC",
  },
  {
    name: "Ethereum",
    segment: "Cripto",
    investedCents: 62000,
    valueCents: 46000,
    monthCents: -1800,
    dividendCents: 0,
    detail: "0,21 ETH",
  },
] as const;

/**
 * Metas.
 *
 * "Reserva de emergência" e' 18.400 no design — exatamente a soma dos dois
 * ativos do segmento "Reserva · caixinhas" (10.240 + 8.160). Nao e'
 * coincidencia, entao e' modelada como vinculada ao segmento em vez de valor
 * digitado: senao o usuario mantem o mesmo numero em dois lugares e eles
 * divergem no primeiro mes.
 */
export const GOALS = [
  {
    name: "Reserva de emergência",
    targetCents: 2400000,
    sourceMode: "linked_segment" as const,
    linkedSegment: "Reserva · caixinhas",
    deadlineLabel: "6 meses de custo",
    color: "oklch(0.80 0.14 128)",
  },
  {
    name: "Viagem · Patagônia",
    targetCents: 800000,
    sourceMode: "manual" as const,
    manualAmountCents: 320000,
    deadlineLabel: "meta out/2027",
    color: "oklch(0.76 0.13 200)",
  },
  {
    name: "Trocar o carro",
    targetCents: 3000000,
    sourceMode: "manual" as const,
    manualAmountCents: 640000,
    deadlineLabel: "meta dez/2028",
    color: "oklch(0.82 0.15 88)",
  },
] as const;

/** Historico do grafico de 6 meses (FLUXO do design), em centavos. */
export const CASHFLOW_HISTORY = [
  { month: "2026-03", incomeCents: 1145000, expenseCents: 742000, contributionCents: 200000 },
  { month: "2026-04", incomeCents: 1190000, expenseCents: 632000, contributionCents: 240000 },
  { month: "2026-05", incomeCents: 1150000, expenseCents: 718000, contributionCents: 220000 },
  { month: "2026-06", incomeCents: 1190000, expenseCents: 689000, contributionCents: 240000 },
  { month: "2026-07", incomeCents: 1240000, expenseCents: 603800, contributionCents: 260000 },
] as const;

/** Totais que o seed TEM que reproduzir. Sao o criterio de aceite do passo. */
export const EXPECTED_TOTALS = {
  expenseCents: 738945,
  incomeCents: 1240000,
  contributionCents: 260000,
  nubankClosedCents: 284287,
  investedCents: 6292000,
  portfolioCents: 6842000,
} as const;
