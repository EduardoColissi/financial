ALTER TABLE "credit_cards" DROP CONSTRAINT IF EXISTS "credit_cards_default_payment_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "credit_cards" DROP COLUMN IF EXISTS "default_payment_account_id";
