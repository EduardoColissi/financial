CREATE TABLE "goal_assets" (
	"goal_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	CONSTRAINT "goal_assets_goal_id_asset_id_pk" PRIMARY KEY("goal_id","asset_id")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"target_cents" integer NOT NULL,
	"source_mode" "goal_source_mode" DEFAULT 'manual' NOT NULL,
	"manual_amount_cents" integer,
	"linked_segment_id" uuid,
	"deadline_label" text,
	"deadline_on" date,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "goals_target_ck" CHECK ("goals"."target_cents" > 0),
	CONSTRAINT "goals_source_ck" CHECK (("goals"."source_mode" = 'manual'         and "goals"."manual_amount_cents" is not null) or
          ("goals"."source_mode" = 'linked_segment' and "goals"."linked_segment_id"   is not null) or
          ("goals"."source_mode" = 'linked_assets'))
);
--> statement-breakpoint
CREATE TABLE "investment_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"name" text NOT NULL,
	"ticker" text,
	"detail" text,
	"custodian" text,
	"color_override" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "investment_flows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"kind" "investment_flow_kind" NOT NULL,
	"occurred_on" date NOT NULL,
	"ref_month" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"quantity" numeric(20, 8),
	"reinvested" boolean DEFAULT true NOT NULL,
	"transaction_id" uuid,
	"notes" text,
	CONSTRAINT "flows_amount_ck" CHECK ("investment_flows"."amount_cents" > 0),
	CONSTRAINT "flows_ref_ck" CHECK (extract(day from "investment_flows"."ref_month") = 1),
	CONSTRAINT "flows_cash_link_ck" CHECK ("investment_flows"."kind" in ('contribution','withdrawal') or "investment_flows"."transaction_id" is null)
);
--> statement-breakpoint
CREATE TABLE "investment_segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"target_percent" numeric(5, 2),
	"sort_order" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "segments_target_ck" CHECK ("investment_segments"."target_percent" is null or ("investment_segments"."target_percent" >= 0 and "investment_segments"."target_percent" <= 100))
);
--> statement-breakpoint
CREATE TABLE "investment_valuations" (
	"user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"ref_month" date NOT NULL,
	"market_value_cents" integer NOT NULL,
	"measured_on" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_valuations_asset_id_ref_month_pk" PRIMARY KEY("asset_id","ref_month"),
	CONSTRAINT "valuations_value_ck" CHECK ("investment_valuations"."market_value_cents" >= 0),
	CONSTRAINT "valuations_ref_ck" CHECK (extract(day from "investment_valuations"."ref_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "recurrence_kind" NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"account_id" uuid,
	"card_id" uuid,
	"due_day" smallint NOT NULL,
	"amount_cents" integer,
	"is_variable" boolean DEFAULT false NOT NULL,
	"estimated_cents" integer,
	"autopay" boolean DEFAULT false NOT NULL,
	"first_ref_month" date NOT NULL,
	"installments_total" smallint,
	"end_ref_month" date,
	"paused_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"source_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rules_target_ck" CHECK (("recurring_rules"."account_id" is not null) <> ("recurring_rules"."card_id" is not null)),
	CONSTRAINT "rules_due_day_ck" CHECK ("recurring_rules"."due_day" between 1 and 31),
	CONSTRAINT "rules_amount_ck" CHECK (("recurring_rules"."is_variable" and "recurring_rules"."amount_cents" is null)
          or (not "recurring_rules"."is_variable" and "recurring_rules"."amount_cents" is not null and "recurring_rules"."amount_cents" > 0)),
	CONSTRAINT "rules_estimated_ck" CHECK ("recurring_rules"."estimated_cents" is null or "recurring_rules"."estimated_cents" >= 0),
	CONSTRAINT "rules_inst_ck" CHECK ("recurring_rules"."installments_total" is null or "recurring_rules"."installments_total" >= 1),
	CONSTRAINT "rules_first_ck" CHECK (extract(day from "recurring_rules"."first_ref_month") = 1),
	CONSTRAINT "rules_end_ck" CHECK ("recurring_rules"."end_ref_month" is null or extract(day from "recurring_rules"."end_ref_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "scheduled_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"ref_month" date NOT NULL,
	"sequence" smallint,
	"due_date" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"amount_overridden" boolean DEFAULT false NOT NULL,
	"status" "occurrence_status" DEFAULT 'pending' NOT NULL,
	"paid_on" date,
	"transaction_id" uuid,
	"statement_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "occ_paid_ck" CHECK (("scheduled_charges"."status" = 'paid') = ("scheduled_charges"."paid_on" is not null)),
	CONSTRAINT "occ_ref_ck" CHECK (extract(day from "scheduled_charges"."ref_month") = 1),
	CONSTRAINT "occ_amount_ck" CHECK ("scheduled_charges"."amount_cents" >= 0),
	CONSTRAINT "occ_sequence_ck" CHECK ("scheduled_charges"."sequence" is null or "scheduled_charges"."sequence" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"start_ref_month" date NOT NULL,
	"max_future_months" smallint DEFAULT 24 NOT NULL,
	"hide_values_default" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid,
	"before_cents" integer,
	"after_cents" integer,
	"detail" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_budgets" (
	"user_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"ref_month" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_budgets_category_id_ref_month_pk" PRIMARY KEY("category_id","ref_month"),
	CONSTRAINT "budgets_amount_ck" CHECK ("category_budgets"."amount_cents" >= 0),
	CONSTRAINT "budgets_ref_ck" CHECK (extract(day from "category_budgets"."ref_month") = 1)
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ip" text NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"succeeded" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_cashflow_snapshots" (
	"user_id" uuid NOT NULL,
	"ref_month" date NOT NULL,
	"income_cents" integer DEFAULT 0 NOT NULL,
	"expense_cents" integer DEFAULT 0 NOT NULL,
	"contribution_cents" integer DEFAULT 0 NOT NULL,
	"withdrawal_cents" integer DEFAULT 0 NOT NULL,
	"cash_balance_end_cents" integer,
	"investment_value_end_cents" integer,
	"net_worth_end_cents" integer,
	"frozen" boolean DEFAULT false NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_cashflow_snapshots_user_id_ref_month_pk" PRIMARY KEY("user_id","ref_month"),
	CONSTRAINT "snap_ref_ck" CHECK (extract(day from "monthly_cashflow_snapshots"."ref_month") = 1)
);
--> statement-breakpoint
ALTER TABLE "goal_assets" ADD CONSTRAINT "goal_assets_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_assets" ADD CONSTRAINT "goal_assets_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_linked_segment_id_investment_segments_id_fk" FOREIGN KEY ("linked_segment_id") REFERENCES "public"."investment_segments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_assets" ADD CONSTRAINT "investment_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_assets" ADD CONSTRAINT "investment_assets_segment_id_investment_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."investment_segments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_flows" ADD CONSTRAINT "investment_flows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_flows" ADD CONSTRAINT "investment_flows_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_flows" ADD CONSTRAINT "investment_flows_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_segments" ADD CONSTRAINT "investment_segments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_valuations" ADD CONSTRAINT "investment_valuations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investment_valuations" ADD CONSTRAINT "investment_valuations_asset_id_investment_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."investment_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_card_id_credit_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."credit_cards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_source_transaction_id_transactions_id_fk" FOREIGN KEY ("source_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_charges" ADD CONSTRAINT "scheduled_charges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_charges" ADD CONSTRAINT "scheduled_charges_rule_id_recurring_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_charges" ADD CONSTRAINT "scheduled_charges_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_charges" ADD CONSTRAINT "scheduled_charges_statement_id_card_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."card_statements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_budgets" ADD CONSTRAINT "category_budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_budgets" ADD CONSTRAINT "category_budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_cashflow_snapshots" ADD CONSTRAINT "monthly_cashflow_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" USING btree ("user_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_user_name_uq" ON "investment_assets" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "assets_user_segment_idx" ON "investment_assets" USING btree ("user_id","segment_id");--> statement-breakpoint
CREATE INDEX "flows_user_asset_month_idx" ON "investment_flows" USING btree ("user_id","asset_id","ref_month");--> statement-breakpoint
CREATE INDEX "flows_user_month_idx" ON "investment_flows" USING btree ("user_id","ref_month");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_user_name_uq" ON "investment_segments" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "valuations_user_month_idx" ON "investment_valuations" USING btree ("user_id","ref_month");--> statement-breakpoint
CREATE INDEX "rules_user_live_idx" ON "recurring_rules" USING btree ("user_id","archived_at","paused_at");--> statement-breakpoint
CREATE UNIQUE INDEX "occ_rule_month_uq" ON "scheduled_charges" USING btree ("rule_id","ref_month");--> statement-breakpoint
CREATE INDEX "occ_user_month_status_idx" ON "scheduled_charges" USING btree ("user_id","ref_month","status");--> statement-breakpoint
CREATE INDEX "occ_user_due_idx" ON "scheduled_charges" USING btree ("user_id","due_date");--> statement-breakpoint
CREATE INDEX "occ_statement_idx" ON "scheduled_charges" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "audit_user_time_idx" ON "audit_log" USING btree ("user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "budgets_user_month_idx" ON "category_budgets" USING btree ("user_id","ref_month");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_time_idx" ON "login_attempts" USING btree ("ip","attempted_at");