-- O aporte passa a apontar para um SETOR, e nao para uma categoria.
--
-- A ordem importa: colunas novas primeiro, DADOS depois, CHECK por ultimo. Criar
-- o CHECK antes de converter os dados recusaria a migration inteira, porque todo
-- `investment_out` existente tem categoria e nenhum tem setor — exatamente o
-- contrario do que a regra nova exige.

ALTER TABLE "investment_sectors" ADD COLUMN "annual_target_cents" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "sector_id" uuid;--> statement-breakpoint

-- A regra ANTIGA sai antes dos dados, nao depois. Ela diz "sem categoria = e'
-- transferencia", e a conversao abaixo zera a categoria de todo aporte — com ela
-- de pe', o proprio UPDATE da migration seria recusado.
ALTER TABLE "transactions" DROP CONSTRAINT IF EXISTS "tx_category_ck";--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sector_id_investment_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."investment_sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Cada categoria de aporte vira um setor de mesmo nome, se ainda nao houver um.
-- A comparacao e' por `lower(name)` porque e' assim que o indice unico de setor
-- ja' funciona: "Reserva de Emergencia" nao pode virar um segundo setor ao lado
-- do "Reserva de Emergencia" que o dono ja' cadastrou.
INSERT INTO "investment_sectors" ("user_id", "name", "color", "share_percent")
SELECT c."user_id", c."name", c."color", 0
  FROM "categories" c
 WHERE c."kind" = 'investment'
   AND NOT EXISTS (
     SELECT 1 FROM "investment_sectors" s
      WHERE s."user_id" = c."user_id" AND lower(s."name") = lower(c."name")
   );--> statement-breakpoint

-- Os aportes existentes trocam categoria por setor, sem perder valor nem data.
UPDATE "transactions" t
   SET "sector_id" = s."id", "category_id" = NULL
  FROM "categories" c
  JOIN "investment_sectors" s
    ON s."user_id" = c."user_id" AND lower(s."name") = lower(c."name")
 WHERE t."category_id" = c."id" AND c."kind" = 'investment';--> statement-breakpoint

-- Rede de seguranca: aporte que ficou sem setor (categoria apagada antes desta
-- migration) adota o primeiro setor do dono. Sem isto o CHECK abaixo recusaria a
-- linha e a migration inteira falharia por causa de um orfao.
INSERT INTO "investment_sectors" ("user_id", "name", "color", "share_percent")
SELECT DISTINCT t."user_id", 'Aporte', 'oklch(0.74 0.13 210)', 0
  FROM "transactions" t
 WHERE t."kind" IN ('investment_out', 'investment_in')
   AND t."sector_id" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "investment_sectors" s WHERE s."user_id" = t."user_id");--> statement-breakpoint

UPDATE "transactions" t
   SET "sector_id" = (
         SELECT s."id" FROM "investment_sectors" s
          WHERE s."user_id" = t."user_id"
          ORDER BY s."sort_order", s."name" LIMIT 1),
       "category_id" = NULL
 WHERE t."kind" IN ('investment_out', 'investment_in') AND t."sector_id" IS NULL;--> statement-breakpoint

-- As categorias de aporte perdem a razao de existir.
DELETE FROM "categories" WHERE "kind" = 'investment';--> statement-breakpoint

-- A tabela de contribuicoes guardava o mesmo dinheiro que o lancamento ja'
-- guardava. Some sem converter nada: os lancamentos correspondentes acabaram de
-- receber o setor logo acima, e recria-los aqui contaria o aporte duas vezes.
ALTER TABLE "sector_contributions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE IF EXISTS "sector_contributions" CASCADE;--> statement-breakpoint

-- Agora sim as regras novas, com os dados ja' no formato que elas exigem.
ALTER TABLE "transactions" ADD CONSTRAINT "tx_category_ck" CHECK (("transactions"."kind" in ('transfer', 'investment_out', 'investment_in')) = ("transactions"."category_id" is null));--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "tx_sector_ck" CHECK (("transactions"."kind" in ('investment_out', 'investment_in')) = ("transactions"."sector_id" is not null));--> statement-breakpoint
ALTER TABLE "investment_sectors" ADD CONSTRAINT "sectors_annual_ck" CHECK ("investment_sectors"."annual_target_cents" is null or "investment_sectors"."annual_target_cents" >= 0);--> statement-breakpoint

-- Debito automatico so' pintava um rotulo: nenhuma conta era quitada sozinha.
ALTER TABLE "recurring_rules" DROP COLUMN IF EXISTS "autopay";
