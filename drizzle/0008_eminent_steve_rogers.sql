CREATE TABLE "investment_sectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"share_percent" smallint DEFAULT 0 NOT NULL,
	"target_cents" integer,
	"is_emergency_fund" boolean DEFAULT false NOT NULL,
	"target_date" date,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sectors_share_ck" CHECK ("investment_sectors"."share_percent" between 0 and 100),
	CONSTRAINT "sectors_target_ck" CHECK ("investment_sectors"."target_cents" is null or "investment_sectors"."target_cents" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sector_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"sector_id" uuid NOT NULL,
	"ref_month" date NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sector_contrib_ref_ck" CHECK (extract(day from "sector_contributions"."ref_month") = 1),
	CONSTRAINT "sector_contrib_amount_ck" CHECK ("sector_contributions"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "investment_sectors" ADD CONSTRAINT "investment_sectors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_contributions" ADD CONSTRAINT "sector_contributions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sector_contributions" ADD CONSTRAINT "sector_contributions_sector_id_investment_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."investment_sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sectors_user_name_uq" ON "investment_sectors" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "sector_contrib_uq" ON "sector_contributions" USING btree ("sector_id","ref_month");--> statement-breakpoint
CREATE INDEX "sector_contrib_user_month_idx" ON "sector_contributions" USING btree ("user_id","ref_month");