CREATE TYPE "public"."account_type" AS ENUM('checking', 'cash', 'brokerage');--> statement-breakpoint
CREATE TYPE "public"."category_kind" AS ENUM('expense', 'income', 'investment');--> statement-breakpoint
CREATE TYPE "public"."goal_source_mode" AS ENUM('manual', 'linked_segment', 'linked_assets');--> statement-breakpoint
CREATE TYPE "public"."investment_flow_kind" AS ENUM('contribution', 'withdrawal', 'dividend', 'fee', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('pending', 'paid', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('pix', 'debit', 'credit', 'boleto', 'cash', 'auto_debit', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."recurrence_kind" AS ENUM('bill', 'subscription');--> statement-breakpoint
CREATE TYPE "public"."statement_status" AS ENUM('open', 'closed', 'paid');--> statement-breakpoint
CREATE TYPE "public"."transaction_kind" AS ENUM('income', 'expense', 'investment_in', 'investment_out', 'transfer');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('manual', 'recurring', 'card_payment', 'import');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"tag" text,
	"initials" text NOT NULL,
	"color" text NOT NULL,
	"opening_balance_cents" integer DEFAULT 0 NOT NULL,
	"opening_balance_on" date NOT NULL,
	"include_in_cash_total" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"kind" "category_kind" DEFAULT 'expense' NOT NULL,
	"monthly_budget_cents" integer,
	"is_system" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "categories_group_ck" CHECK (("categories"."kind" = 'expense') = ("categories"."group_id" is not null)),
	CONSTRAINT "categories_budget_ck" CHECK ("categories"."monthly_budget_cents" is null or "categories"."monthly_budget_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "category_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text NOT NULL,
	"last_four" text,
	"limit_cents" integer NOT NULL,
	"closing_day" smallint NOT NULL,
	"due_day" smallint NOT NULL,
	"best_day_override" smallint,
	"default_payment_account_id" uuid,
	"color" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "cards_closing_day_ck" CHECK ("credit_cards"."closing_day" between 1 and 31),
	CONSTRAINT "cards_due_day_ck" CHECK ("credit_cards"."due_day" between 1 and 31),
	CONSTRAINT "cards_best_day_ck" CHECK ("credit_cards"."best_day_override" is null or "credit_cards"."best_day_override" between 1 and 31),
	CONSTRAINT "cards_limit_ck" CHECK ("credit_cards"."limit_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "card_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"ref_month" date NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"due_date" date NOT NULL,
	"status" "statement_status" DEFAULT 'open' NOT NULL,
	"closed_total_cents" integer,
	"closed_at" timestamp with time zone,
	"paid_on" date,
	"paid_amount_cents" integer,
	"payment_transaction_id" uuid,
	CONSTRAINT "statements_period_ck" CHECK ("card_statements"."period_end" >= "card_statements"."period_start"),
	CONSTRAINT "statements_ref_ck" CHECK (extract(day from "card_statements"."ref_month") = 1),
	CONSTRAINT "statements_paid_ck" CHECK (("card_statements"."status" = 'paid') = ("card_statements"."paid_on" is not null)),
	CONSTRAINT "statements_amounts_ck" CHECK (("card_statements"."closed_total_cents" is null or "card_statements"."closed_total_cents" >= 0)
          and ("card_statements"."paid_amount_cents" is null or "card_statements"."paid_amount_cents" >= 0))
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "transaction_kind" NOT NULL,
	"occurred_on" date NOT NULL,
	"competence_month" date NOT NULL,
	"description" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"category_id" uuid,
	"method" "payment_method" NOT NULL,
	"account_id" uuid,
	"card_id" uuid,
	"transfer_account_id" uuid,
	"statement_id" uuid,
	"installment_seq" smallint,
	"installment_total" smallint,
	"is_refund" boolean DEFAULT false NOT NULL,
	"settled_on" date,
	"notes" text,
	"source" "transaction_source" DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tx_amount_ck" CHECK ("transactions"."amount_cents" > 0 and "transactions"."amount_cents" < 2000000000),
	CONSTRAINT "tx_competence_ck" CHECK (extract(day from "transactions"."competence_month") = 1),
	CONSTRAINT "tx_installment_ck" CHECK (("transactions"."installment_seq" is null) = ("transactions"."installment_total" is null)
          and ("transactions"."installment_seq" is null or "transactions"."installment_seq" between 1 and "transactions"."installment_total")),
	CONSTRAINT "tx_category_ck" CHECK (("transactions"."kind" = 'transfer') = ("transactions"."category_id" is null)),
	CONSTRAINT "tx_card_method_ck" CHECK (("transactions"."card_id" is not null) = ("transactions"."method" = 'credit')),
	CONSTRAINT "tx_target_ck" CHECK (case "transactions"."kind"
            when 'expense'        then ("transactions"."card_id" is not null) <> ("transactions"."account_id" is not null)
            when 'income'         then "transactions"."account_id" is not null and "transactions"."card_id" is null
            when 'investment_out' then "transactions"."account_id" is not null and "transactions"."card_id" is null
            when 'investment_in'  then "transactions"."account_id" is not null and "transactions"."card_id" is null
            when 'transfer'       then "transactions"."account_id" is not null
                                      and ("transactions"."transfer_account_id" is not null or "transactions"."statement_id" is not null)
          end)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_group_id_category_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."category_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_groups" ADD CONSTRAINT "category_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_cards" ADD CONSTRAINT "credit_cards_default_payment_account_id_accounts_id_fk" FOREIGN KEY ("default_payment_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_statements" ADD CONSTRAINT "card_statements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_statements" ADD CONSTRAINT "card_statements_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_statements" ADD CONSTRAINT "card_statements_payment_transaction_id_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_transfer_account_id_accounts_id_fk" FOREIGN KEY ("transfer_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_statement_id_card_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."card_statements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_name_uq" ON "accounts" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_name_uq" ON "categories" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "categories_user_kind_idx" ON "categories" USING btree ("user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "cat_groups_user_name_uq" ON "category_groups" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "cards_user_name_uq" ON "credit_cards" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "statements_card_month_uq" ON "card_statements" USING btree ("card_id","ref_month");--> statement-breakpoint
CREATE INDEX "statements_user_due_idx" ON "card_statements" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "tx_user_competence_idx" ON "transactions" USING btree ("user_id","competence_month");--> statement-breakpoint
CREATE INDEX "tx_user_account_date_idx" ON "transactions" USING btree ("user_id","account_id","occurred_on");--> statement-breakpoint
CREATE INDEX "tx_user_statement_idx" ON "transactions" USING btree ("user_id","statement_id");--> statement-breakpoint
CREATE INDEX "tx_user_category_month_idx" ON "transactions" USING btree ("user_id","category_id","competence_month");--> statement-breakpoint
CREATE UNIQUE INDEX "tx_external_uq" ON "transactions" USING btree ("user_id","source","external_id") WHERE "transactions"."external_id" is not null;