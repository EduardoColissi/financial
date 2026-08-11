-- Saldo de abertura do setor: o que ja' estava aplicado antes do app existir.
--
-- Default zero, e nao nulo: setor que ja' existe nao tinha abertura declarada, e
-- "nao havia nada" e' a resposta certa para todos eles. O valor entra so' no
-- acumulado — nunca no caixa, nem no aportado do mes ou do ano.
ALTER TABLE "investment_sectors" ADD COLUMN "opening_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "investment_sectors" ADD CONSTRAINT "sectors_opening_ck" CHECK ("investment_sectors"."opening_cents" >= 0);