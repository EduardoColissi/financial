ALTER TABLE "login_attempts" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "login_attempts" CASCADE;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "google_sub" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub");