-- `IF EXISTS` nos dois drops de constraint: o `DROP TABLE ... CASCADE` acima ja'
-- derruba a chave estrangeira `categories_group_id_category_groups_id_fk`, e o
-- drizzle-kit gera o drop dela DEPOIS. Sem o `IF EXISTS`, o Postgres recusa com
-- 42704 e a migration morre no meio.
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_group_ck";--> statement-breakpoint
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_group_id_category_groups_id_fk";--> statement-breakpoint
ALTER TABLE "categories" DROP COLUMN IF EXISTS "group_id";--> statement-breakpoint
DROP TABLE IF EXISTS "category_groups" CASCADE;
