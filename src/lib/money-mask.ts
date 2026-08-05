/**
 * Mascara de dinheiro do jeito que o banco faz.
 *
 * O usuario digita SO' digitos e eles entram pela direita: 1 vira 0,01; 12 vira
 * 0,12; 1234 vira 12,34. Ponto de milhar e virgula aparecem sozinhos, e nao ha'
 * cursor para posicionar no meio do numero.
 *
 * Isso existe como modulo separado do componente porque o modal de lancamento
 * precisa das MESMAS funcoes com estado proprio (ele calcula a previa enquanto
 * o usuario digita). Duas implementacoes da mascara divergiriam no primeiro
 * ajuste, e a divergencia apareceria como valor gravado diferente do exibido.
 */

import { type Cents, cents } from "@/domain/money";

/**
 * 9 digitos = ate' R$ 9.999.999,99.
 *
 * O teto e' o `MAX_CENTS` do dominio (R$ 20.000.000,00): com 10 digitos daria
 * para digitar um numero que `cents()` recusa, e a recusa so' apareceria no
 * submit. Melhor a tecla nao fazer nada do que o formulario explodir depois.
 */
export const MASK_MAX_DIGITS = 9;

/** Extrai os digitos significativos do que quer que esteja no campo. */
export function onlyDigits(raw: string): string {
  return raw
    .replace(/\D/g, "")
    .replace(/^0+(?=\d)/, "")
    .slice(0, MASK_MAX_DIGITS);
}

const NF = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "1234" -> "12,34". String vazia continua vazia, para o placeholder aparecer. */
export function maskBRL(digits: string): string {
  if (!digits) return "";
  return NF.format(Number(digits) / 100);
}

/** Os digitos JA' sao centavos — nao ha' float no caminho. */
export function centsFromDigits(digits: string): Cents {
  return cents(digits ? Number(digits) : 0);
}

/** Valor inicial de um campo: centavos viram a string de digitos equivalente. */
export function digitsFromCents(value: Cents | number | null | undefined): string {
  if (value == null) return "";
  return onlyDigits(String(Math.round(Math.abs(value))));
}
