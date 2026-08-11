-- O credito passa a pesar no mes em que a fatura VENCE, e o dia do fechamento
-- deixa de caber na fatura que fecha nele.
--
-- Duas regras mudaram no dominio e esta migration alinha o que ja' esta' gravado:
--
--  1. o ciclo cobre [fechamento anterior, vespera do fechamento]. Antes cobria
--     [fechamento anterior + 1, fechamento], ou seja, a compra do dia do
--     fechamento entrava na fatura que fechava naquele mesmo dia — o emissor faz
--     o contrario, e o dono viu isso num cartao que fecha dia 05;
--  2. a competencia de uma despesa no credito e' o mes de vencimento da fatura.
--     Uma assinatura cobrada em 06/08 num cartao que fecha 05 so' e' paga em
--     12/09: cobra-la de agosto tirava o valor de um mes em que nada saiu do
--     caixa, e deixava setembro sem o gasto que de fato pagou.
--
-- A ordem importa: o periodo primeiro, porque os passos seguintes procuram a
-- fatura POR DATA e precisam do intervalo ja' corrigido.

-- 1. Todo periodo anda um dia para tras, nas duas pontas. Toda linha foi gerada
--    por `cycleOfRefMonth`/`cycleFor` com a convencao antiga, entao o
--    deslocamento e' uniforme — e `statements_period_ck` (fim >= inicio)
--    continua valendo, porque as duas pontas andam juntas.
UPDATE "card_statements"
   SET "period_start" = "period_start" - 1,
       "period_end" = "period_end" - 1;--> statement-breakpoint

-- 2. A cobranca que caiu no dia do fechamento estava na fatura errada. Religa
--    pela data, agora contra o periodo novo. Sem fatura correspondente ela fica
--    orfa de proposito: `linkChargesToStatements` cria a fatura que falta e
--    religa na proxima materializacao, que e' o caminho canonico.
UPDATE "scheduled_charges" sc
   SET "statement_id" = (
         SELECT st."id"
           FROM "card_statements" st
           JOIN "recurring_rules" rr ON rr."id" = sc."rule_id"
          WHERE st."card_id" = rr."card_id"
            AND st."user_id" = sc."user_id"
            AND sc."due_date" BETWEEN st."period_start" AND st."period_end"
          LIMIT 1
       )
 WHERE sc."statement_id" IS NOT NULL
   AND NOT EXISTS (
         SELECT 1
           FROM "card_statements" st
          WHERE st."id" = sc."statement_id"
            AND sc."due_date" BETWEEN st."period_start" AND st."period_end"
       );--> statement-breakpoint

-- 3. O lancamento nascido de uma cobranca segue a cobranca. Ele nao tem caminho
--    proprio de reparo — `postDueCharges` so' cria o que ainda nao existe —,
--    entao e' aqui que os dois voltam a apontar para a mesma fatura.
UPDATE "transactions" t
   SET "statement_id" = sc."statement_id"
  FROM "scheduled_charges" sc
 WHERE sc."transaction_id" = t."id"
   AND sc."user_id" = t."user_id"
   AND sc."statement_id" IS NOT NULL
   AND t."statement_id" IS DISTINCT FROM sc."statement_id";--> statement-breakpoint

-- 4. A compra avulsa no credito comprada no dia do fechamento tambem migra. O
--    `coalesce` e' rede: sem fatura para a data ela fica onde esta', porque
--    lancamento sem fatura sumiria do total do cartao.
UPDATE "transactions" t
   SET "statement_id" = coalesce(
         (SELECT st."id"
            FROM "card_statements" st
           WHERE st."card_id" = t."card_id"
             AND st."user_id" = t."user_id"
             AND t."occurred_on" BETWEEN st."period_start" AND st."period_end"
           LIMIT 1),
         t."statement_id"
       )
 WHERE t."card_id" IS NOT NULL
   AND t."statement_id" IS NOT NULL
   AND t."source" <> 'card_payment'
   AND NOT EXISTS (
         SELECT 1
           FROM "card_statements" st
          WHERE st."id" = t."statement_id"
            AND t."occurred_on" BETWEEN st."period_start" AND st."period_end"
       );--> statement-breakpoint

-- 5. A competencia de toda despesa de credito passa a ser o mes da fatura.
--    O pagamento da fatura fica de fora: ele ja' nasce com o mes dela e nao e'
--    despesa — mexer nele contaria o cartao duas vezes no mesmo mes.
UPDATE "transactions" t
   SET "competence_month" = st."ref_month"
  FROM "card_statements" st
 WHERE st."id" = t."statement_id"
   AND st."user_id" = t."user_id"
   AND t."kind" = 'expense'
   AND t."source" <> 'card_payment'
   AND t."competence_month" IS DISTINCT FROM st."ref_month";
