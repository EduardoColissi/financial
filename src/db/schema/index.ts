/**
 * Barrel do schema.
 *
 * Convencao inegociavel deste projeto: dinheiro e' `integer` em centavos e a
 * coluna e' sempre sufixada `_cents`. `numeric` e `bigint` voltam como string
 * no driver `pg`, o que obrigaria lib decimal em toda aritmetica.
 *
 * Outra: `ref_month` (`date` com CHECK de dia = 1) e' a chave temporal
 * universal — faturas, cobrancas, avaliacoes, snapshots e competencia de
 * lancamento usam todos a mesma semantica.
 */

export * from "./core";
export * from "./enums";
export * from "./investments";
export * from "./recurrence";
export * from "./system";
export * from "./transactions";
