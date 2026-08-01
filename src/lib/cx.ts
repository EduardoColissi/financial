/**
 * Concatena classes ignorando o que for falso.
 *
 * Existe por causa do `noUncheckedIndexedAccess`: indexar um CSS Module devolve
 * `string | undefined`, e num template literal o `undefined` viraria a classe
 * literal "undefined" — sem erro de compilacao e sem estilo aplicado. Aqui o
 * caso some.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
