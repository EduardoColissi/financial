/**
 * Barrel do schema. As tabelas entram nos passos 6 e 7 do plano.
 *
 * Convencao inegociavel deste projeto: dinheiro e' `integer` em centavos e a
 * coluna e' sempre sufixada `_cents`. `numeric` e `bigint` voltam como string
 * no driver `pg`, o que obrigaria lib decimal em toda aritmetica.
 */

export {};
