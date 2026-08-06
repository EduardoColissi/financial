import { type Cents, cents, MoneyError, parseBRL } from "./money";

/**
 * Validacao dos cadastros: conta bancaria e cartao de credito.
 *
 * Modulo puro — nao toca em banco nem le' o relogio. As regras que o Postgres ja'
 * garante por CHECK (dia entre 1 e 31, limite nao negativo) sao repetidas aqui de
 * proposito: o banco recusa com uma mensagem que ninguem quer ler, e o formulario
 * precisa apontar QUAL campo esta' errado.
 */

export class RegistryError extends Error {
  constructor(
    readonly field: string,
    message: string
  ) {
    super(message);
  }
}

/**
 * As oito cores do design, oferecidas como atalho. Cor e' DADO escolhido pelo
 * dono, nao token — por isso mora aqui e nao no CSS.
 *
 * Nao sao as unicas possiveis: o formulario tambem aceita cor livre em hex.
 * Elas ficam porque sao boas por construcao — mesma claridade percebida entre
 * si, legiveis sobre o painel escuro — e porque o formulario abre ja' com uma
 * que ninguem usou, o que evita duas contas com o mesmo ponto colorido.
 */
export const PALETTE = [
  "oklch(0.78 0.16 300)",
  "oklch(0.74 0.13 265)",
  "oklch(0.76 0.13 200)",
  "oklch(0.84 0.16 158)",
  "oklch(0.82 0.15 88)",
  "oklch(0.78 0.14 45)",
  "oklch(0.80 0.13 25)",
  "oklch(0.78 0.12 350)",
] as const;

/**
 * O equivalente sRGB de cada preset, so' para SEMEAR o seletor nativo — ele nao
 * sabe ler `oklch()`.
 *
 * Quatro dessas cores ficam fora do sRGB e aqui chegam cortadas, um pouco menos
 * vivas do que em tela P3. Por isso e' ponto de partida do seletor e nao o valor
 * gravado: escolher um preset grava o `oklch` original.
 */
export const PALETTE_HEX: Record<string, string> = {
  "oklch(0.78 0.16 300)": "#c89eff",
  "oklch(0.74 0.13 265)": "#82a8fd",
  "oklch(0.76 0.13 200)": "#00c9d1",
  "oklch(0.84 0.16 158)": "#5be9a2",
  "oklch(0.82 0.15 88)": "#ecbd3a",
  "oklch(0.78 0.14 45)": "#ff9868",
  "oklch(0.80 0.13 25)": "#ff9b93",
  "oklch(0.78 0.12 350)": "#f197c2",
};

export function isPaletteColor(value: string): boolean {
  return (PALETTE as readonly string[]).includes(value);
}

export const ACCOUNT_TYPES = ["checking", "cash", "brokerage"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  checking: "Conta corrente",
  cash: "Dinheiro em espécie",
  brokerage: "Corretora",
};

const NAME_MAX = 40;
const TAG_MAX = 30;
const HOLDER_MAX = 30;

/** `"Nubank · Conta"` -> `"NU"`. Mesma convencao do seed. */
export function initialsFrom(name: string): string {
  const primeira = name
    .trim()
    .split(/[\s·|/-]+/)
    .find((p) => /[\p{L}\p{N}]/u.test(p));
  if (!primeira) return "??";
  const limpo = [...primeira].filter((c) => /[\p{L}\p{N}]/u.test(c));
  return limpo.slice(0, 2).join("").toUpperCase() || "??";
}

function texto(raw: string | undefined, campo: string, rotulo: string, max: number): string {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!v) throw new RegistryError(campo, `${rotulo} é obrigatório.`);
  if (v.length > max) {
    throw new RegistryError(campo, `${rotulo} passa de ${max} caracteres.`);
  }
  return v;
}

/** Campo que pode ficar vazio: devolve `null` em vez de string vazia. */
function opcional(
  raw: string | undefined,
  campo: string,
  rotulo: string,
  max: number
): string | null {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!v) return null;
  if (v.length > max) throw new RegistryError(campo, `${rotulo} passa de ${max} caracteres.`);
  return v;
}

const HEX = /^#[0-9a-f]{6}$/;

/**
 * Duas formas aceitas e nada alem: um preset da paleta, exatamente como esta' na
 * constante, ou um hex de 6 digitos vindo do seletor nativo.
 *
 * A cor vai parar num atributo `style`, entao a regra existe para impedir que um
 * POST fabricado grave CSS arbitrario ali. A regex nao deixa passar parentese,
 * espaco nem barra — nao ha' como contrabandear um `url(...)` para dentro dela.
 */
export function parseColor(raw: string | undefined, campo = "color"): string {
  const v = (raw ?? "").trim().toLowerCase();
  if (isPaletteColor(v) || HEX.test(v)) return v;
  throw new RegistryError(campo, "Escolha uma cor da paleta ou um hex como #a1b2c3.");
}

function dia(raw: string | undefined, campo: string, rotulo: string): number {
  const v = (raw ?? "").trim();
  if (!v) throw new RegistryError(campo, `${rotulo} é obrigatório.`);
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 31) {
    throw new RegistryError(campo, `${rotulo} tem que ser um dia entre 1 e 31.`);
  }
  return n;
}

function dinheiro(
  raw: string | undefined,
  campo: string,
  rotulo: string,
  permiteNegativo: boolean
): Cents {
  const v = (raw ?? "").trim();
  if (!v) return cents(0);
  let valor: Cents;
  try {
    valor = parseBRL(v);
  } catch (e) {
    if (e instanceof MoneyError) throw new RegistryError(campo, `${rotulo} não é um valor válido.`);
    throw e;
  }
  if (!permiteNegativo && valor < 0) {
    throw new RegistryError(campo, `${rotulo} não pode ser negativo.`);
  }
  return valor;
}

// ── conta ────────────────────────────────────────────────────────────────────

export interface AccountDraft {
  name: string;
  type: AccountType;
  tag: string | null;
  holder: string | null;
  initials: string;
  color: string;
  includeInCashTotal: boolean;
}

export function parseAccountForm(campos: Record<string, string | undefined>): AccountDraft {
  const name = texto(campos.name, "name", "O nome", NAME_MAX);

  const tipo = (campos.type ?? "").trim();
  if (!(ACCOUNT_TYPES as readonly string[]).includes(tipo)) {
    throw new RegistryError("type", "Escolha o tipo da conta.");
  }

  return {
    name,
    type: tipo as AccountType,
    tag: opcional(campos.tag, "tag", "A etiqueta", TAG_MAX),
    holder: opcional(campos.holder, "holder", "O titular", HOLDER_MAX),
    // Iniciais em branco derivam do nome — e' o caso comum, e obrigar a digitar
    // duas letras seria atrito puro.
    initials: (
      opcional(campos.initials, "initials", "As iniciais", 3) ?? initialsFrom(name)
    ).toUpperCase(),
    color: parseColor(campos.color),
    // Corretora fica fora do "dinheiro em caixa" por padrao: o valor investido
    // nao e' saldo disponivel, e soma-lo inflaria a sobra do mes.
    includeInCashTotal: campos.includeInCashTotal
      ? campos.includeInCashTotal === "on" || campos.includeInCashTotal === "true"
      : tipo !== "brokerage",
  };
}

// ── cartao ───────────────────────────────────────────────────────────────────

export interface CardDraft {
  name: string;
  brand: string;
  lastFour: string | null;
  holder: string | null;
  limitCents: Cents;
  closingDay: number;
  dueDay: number;
  color: string;
}

export function parseCardForm(campos: Record<string, string | undefined>): CardDraft {
  const lastFour = opcional(campos.lastFour, "lastFour", "Os quatro dígitos", 4);
  if (lastFour !== null && !/^\d{4}$/.test(lastFour)) {
    throw new RegistryError("lastFour", "Informe exatamente 4 dígitos, ou deixe em branco.");
  }

  const closingDay = dia(campos.closingDay, "closingDay", "O dia de fechamento");
  const dueDay = dia(campos.dueDay, "dueDay", "O dia de vencimento");

  return {
    name: texto(campos.name, "name", "O nome", NAME_MAX),
    brand: texto(campos.brand, "brand", "A bandeira", NAME_MAX),
    lastFour,
    holder: opcional(campos.holder, "holder", "O titular", HOLDER_MAX),
    limitCents: dinheiro(campos.limit, "limit", "O limite", false),
    closingDay,
    dueDay,
    color: parseColor(campos.color),
  };
}

// ── categoria ────────────────────────────────────────────────────────────────

/*
 * So' duas naturezas. "Aporte" saiu: o destino de um aporte e' um SETOR de
 * investimento, cadastrado na aba propria. Ter categoria de aporte obrigava a
 * cadastrar cada destino duas vezes, com os mesmos nomes, e nada garantia que
 * as duas listas concordassem.
 */
export const CATEGORY_KINDS = ["expense", "income"] as const;
export type CategoryKind = (typeof CATEGORY_KINDS)[number];

export const CATEGORY_KIND_LABEL: Record<CategoryKind, string> = {
  expense: "Gasto",
  income: "Receita",
};

export interface CategoryDraft {
  name: string;
  kind: CategoryKind;
  color: string;
  /** So' gasto tem orcamento. `null` = sem teto definido. */
  monthlyBudgetCents: Cents | null;
}

/**
 * Categorias sao planas: nao ha' grupo acima delas.
 *
 * Orcamento so' existe para gasto — orcar receita nao quer dizer nada, e deixar
 * o campo aparecer para os outros tipos convidaria a preencher lixo. O valor e'
 * descartado se vier num tipo que nao seja `expense`, em vez de recusado: o
 * usuario pode ter digitado antes de trocar o tipo, e perder o formulario
 * inteiro por isso seria hostil.
 */
export function parseCategoryForm(campos: Record<string, string | undefined>): CategoryDraft {
  const tipo = (campos.kind ?? "").trim();
  if (!(CATEGORY_KINDS as readonly string[]).includes(tipo)) {
    throw new RegistryError("kind", "Escolha o tipo da categoria.");
  }
  const kind = tipo as CategoryKind;

  const bruto = (campos.budget ?? "").trim();
  const orcamento =
    kind === "expense" && bruto ? dinheiro(bruto, "budget", "O orçamento", false) : null;

  return {
    name: texto(campos.name, "name", "O nome", NAME_MAX),
    kind,
    color: parseColor(campos.color),
    monthlyBudgetCents: orcamento,
  };
}

// ── conta fixa e assinatura ──────────────────────────────────────────────────

export const RECURRENCE_KINDS = ["bill", "subscription"] as const;
export type RecurrenceKind = (typeof RECURRENCE_KINDS)[number];

export const RECURRENCE_KIND_LABEL: Record<RecurrenceKind, string> = {
  bill: "Conta (débito, pix, boleto)",
  subscription: "Assinatura (cartão)",
};

export const PAYMENT_METHODS = ["pix", "debit", "boleto", "cash", "auto_debit"] as const;
export type BillMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<BillMethod, string> = {
  pix: "Pix",
  debit: "Débito",
  boleto: "Boleto",
  cash: "Dinheiro",
  auto_debit: "Débito automático",
};

export interface RecurringDraft {
  name: string;
  kind: RecurrenceKind;
  categoryId: string;
  /** `credit` quando cai em cartao — derivado do tipo, nao escolhido. */
  method: BillMethod | "credit";
  accountId: string | null;
  cardId: string | null;
  dueDay: number;
  amountCents: Cents | null;
  isVariable: boolean;
  estimatedCents: Cents | null;
  essential: boolean;
  firstRefMonth: string;
  installmentsTotal: number | null;
}

/**
 * Conta fixa e assinatura sao a MESMA entidade — o que muda e' o canal.
 *
 * `bill` sai de uma conta; `subscription` cai na fatura de um cartao. Nao e'
 * "fixa x parcelada": ha' parcelamento em boleto, e o formulario precisa
 * permitir isso sem contorcionismo.
 */
export function parseRecurringForm(campos: Record<string, string | undefined>): RecurringDraft {
  const tipo = (campos.kind ?? "").trim();
  if (!(RECURRENCE_KINDS as readonly string[]).includes(tipo)) {
    throw new RegistryError("kind", "Escolha se é conta ou assinatura.");
  }
  const kind = tipo as RecurrenceKind;

  const categoryId = (campos.categoryId ?? "").trim();
  if (!categoryId) throw new RegistryError("categoryId", "Escolha a categoria.");

  const accountId = (campos.accountId ?? "").trim() || null;
  const cardId = (campos.cardId ?? "").trim() || null;

  if (kind === "subscription" && !cardId) {
    throw new RegistryError("cardId", "Assinatura precisa de um cartão.");
  }
  if (kind === "bill" && !accountId) {
    throw new RegistryError("accountId", "Conta precisa de uma conta de pagamento.");
  }

  let method: BillMethod | "credit" = "credit";
  if (kind === "bill") {
    const m = (campos.method ?? "").trim();
    if (!(PAYMENT_METHODS as readonly string[]).includes(m)) {
      throw new RegistryError("method", "Escolha a forma de pagamento.");
    }
    method = m as BillMethod;
  }

  const isVariable = campos.isVariable === "on" || campos.isVariable === "true";
  const valorBruto = (campos.amount ?? "").trim();

  // Conta variavel guarda ESTIMATIVA, nao valor: o real chega todo mes e e'
  // digitado na ocorrencia. Trocar os dois campos faria a estimativa virar
  // verdade e o mes fechar com numero inventado.
  if (!valorBruto) {
    throw new RegistryError("amount", isVariable ? "Informe a estimativa." : "Informe o valor.");
  }
  const valor = dinheiro(valorBruto, "amount", isVariable ? "A estimativa" : "O valor", false);

  const parcelasBruto = (campos.installments ?? "").trim();
  let installmentsTotal: number | null = null;
  if (parcelasBruto) {
    const n = Number(parcelasBruto);
    if (!Number.isInteger(n) || n < 2 || n > 120) {
      throw new RegistryError("installments", "Parcelas entre 2 e 120, ou vazio para sem fim.");
    }
    installmentsTotal = n;
  }

  const primeiroMes = (campos.firstRefMonth ?? "").trim();
  if (!/^\d{4}-\d{2}$/.test(primeiroMes)) {
    throw new RegistryError("firstRefMonth", "Informe o mês em que começou.");
  }

  return {
    name: texto(campos.name, "name", "O nome", NAME_MAX),
    kind,
    categoryId,
    method,
    accountId: kind === "bill" ? accountId : null,
    cardId: kind === "subscription" ? cardId : null,
    dueDay: dia(campos.dueDay, "dueDay", "O dia de vencimento"),
    amountCents: isVariable ? null : valor,
    isVariable,
    estimatedCents: isVariable ? valor : null,
    essential: campos.essential === "on" || campos.essential === "true",
    firstRefMonth: primeiroMes,
    installmentsTotal,
  };
}

/**
 * Quantos dias da compra ate' a fatura vencer, comprando logo apos o fechamento.
 *
 * Serve de conferencia no formulario: fechamento e vencimento trocados produzem
 * uma janela absurdamente curta, e o numero na tela denuncia o engano antes de
 * ele contaminar meses de fatura.
 */
export function daysOfFloat(closingDay: number, dueDay: number): number {
  const bruto = dueDay - closingDay;
  return bruto > 0 ? bruto + 30 : bruto + 60;
}
