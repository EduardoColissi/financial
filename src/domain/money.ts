/**
 * Dinheiro. Sempre inteiro, sempre em centavos.
 *
 * O design de origem usa float em todo lugar (`valor: 2959.90`, `nvVal/nvParc`)
 * e por isso a soma das parcelas nao fecha e os totais divergem por centavos.
 * Aqui isso e' impossivel por construcao: `Cents` e' um tipo branded, entao um
 * float em reais nao entra sem passar por `fromReais`.
 */

declare const centsBrand: unique symbol;

/** Valor monetario em centavos. Inteiro, podendo ser negativo em resultados. */
export type Cents = number & { readonly [centsBrand]: true };

/** Teto de sanidade: `integer` do Postgres vai ate' R$ 21.474.836,47. */
export const MAX_CENTS = 2_000_000_000;

export class MoneyError extends Error {}

/** Constroi um `Cents` a partir de um inteiro ja' em centavos. */
export function cents(value: number): Cents {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`Centavos precisam ser inteiros, recebido: ${value}`);
  }
  if (Math.abs(value) > MAX_CENTS) {
    throw new MoneyError(`Valor fora da faixa suportada: ${value}`);
  }
  return value as Cents;
}

export const ZERO = cents(0);

/** Converte reais (float) para centavos, arredondando. Fronteira de entrada. */
export function fromReais(reais: number): Cents {
  if (!Number.isFinite(reais)) {
    throw new MoneyError(`Valor invalido: ${reais}`);
  }
  // O epsilon evita que 19.99 * 100 = 1998.9999999999998 vire 1998.
  return cents(Math.round((reais + Number.EPSILON) * 100));
}

/** Converte centavos para reais. Use apenas para exibir ou exportar. */
export function toReais(value: Cents): number {
  return value / 100;
}

export function sumCents(values: readonly Cents[]): Cents {
  return cents(values.reduce<number>((acc, v) => acc + v, 0));
}

export function addCents(a: Cents, b: Cents): Cents {
  return cents(a + b);
}

export function subCents(a: Cents, b: Cents): Cents {
  return cents(a - b);
}

export function absCents(a: Cents): Cents {
  return cents(Math.abs(a));
}

export function maxCents(a: Cents, b: Cents): Cents {
  return a >= b ? a : b;
}

/** Multiplica por um inteiro (numero de parcelas, quantidade). */
export function multiplyCents(value: Cents, factor: number): Cents {
  if (!Number.isInteger(factor)) {
    throw new MoneyError(`Fator precisa ser inteiro, recebido: ${factor}`);
  }
  return cents(value * factor);
}

/**
 * Divide um total em N parcelas sem perder nem inventar centavo.
 *
 * O resto vai para a PRIMEIRA parcela — R$ 100,00 em 3x da' 33,34 / 33,33 /
 * 33,33. E' a convencao do mercado brasileiro (a primeira absorve a diferenca)
 * e garante a invariante testada: a soma e' exatamente o total.
 */
export function splitInstallments(total: Cents, count: number): Cents[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new MoneyError(`Numero de parcelas invalido: ${count}`);
  }
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const base = Math.floor(abs / count);
  const remainder = abs - base * count;

  return Array.from({ length: count }, (_, i) => cents(sign * (i === 0 ? base + remainder : base)));
}

// ── parsing de entrada ───────────────────────────────────────────────────────

/**
 * Le' um valor digitado pelo usuario em pt-BR.
 *
 * Aceita "1.234,56", "1234,56", "R$ 1.234,56" e tambem "1234.56" (quem digita
 * em teclado numerico costuma usar ponto). A regra de desambiguacao: se ha'
 * virgula, o ponto e' separador de milhar; se nao ha', um unico ponto com ate'
 * 2 casas depois e' decimal.
 */
export function parseBRL(input: string): Cents {
  const cleaned = input.replace(/\s| /g, "").replace(/R\$/gi, "").trim();

  if (cleaned === "") throw new MoneyError("Valor vazio");

  const negative = cleaned.startsWith("-") || cleaned.startsWith("−");
  const digits = cleaned.replace(/^[-−+]/, "");

  if (!/^[\d.,]+$/.test(digits)) {
    throw new MoneyError(`Valor invalido: ${input}`);
  }

  let normalized: string;
  if (digits.includes(",")) {
    normalized = digits.replace(/\./g, "").replace(",", ".");
  } else {
    const parts = digits.split(".");
    const last = parts.at(-1);
    // "1.234" e' mil duzentos e trinta e quatro; "1234.5" sao reais e centavos.
    const dotIsDecimal = parts.length === 2 && last !== undefined && last.length <= 2;
    normalized = dotIsDecimal ? digits : digits.replace(/\./g, "");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new MoneyError(`Valor invalido: ${input}`);

  const result = fromReais(value);
  return negative ? cents(-result) : result;
}

// ── formatacao ───────────────────────────────────────────────────────────────

const NF2 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const NF0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const NF1 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** Glifo de menos (U+2212), nao hifen. E' o que o design usa. */
export const MINUS = "−";
export const PLUS = "+";
/** Seta de aporte (U+2197). */
export const UP = "↗";
export const MASK = "R$ ••••";

/** "R$ 1.234,56" */
export function brl(value: Cents): string {
  return `R$ ${NF2.format(toReais(value))}`;
}

/** "R$ 1.235" — sem casas decimais. */
export function brl0(value: Cents): string {
  return `R$ ${NF0.format(toReais(value))}`;
}

/** 42.37 -> "42,4%" */
export function pct(value: number): string {
  return `${NF1.format(value)}%`;
}

/** 4.2 -> "+4,2 pp" | -1.8 -> "−1,8 pp" */
export function pp(value: number): string {
  return `${value >= 0 ? PLUS : MINUS}${NF1.format(Math.abs(value))} pp`;
}

export type FlowKind = "receita" | "despesa" | "aporte";

/** "+ R$ 9.800,00" | "− R$ 2.200,00" | "↗ R$ 2.600,00" */
export function signedBrl(value: Cents, kind: FlowKind): string {
  const prefix = kind === "receita" ? PLUS : kind === "aporte" ? UP : MINUS;
  return `${prefix} ${brl(absCents(value))}`;
}

/** Saldo compacto do grafico de fluxo: 403000 -> "+4,0k" */
export function compactK(value: Cents): string {
  const thousands = toReais(value) / 1000;
  const sign = thousands < 0 ? MINUS : PLUS;
  return `${sign}${NF1.format(Math.abs(thousands))}k`;
}
