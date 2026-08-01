import { existsSync } from "node:fs";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { requireUrl } from "./_shared";

const MIGRATIONS_FOLDER = "./drizzle";

/**
 * Migrations rodam por comando explicito, NUNCA no build da Vercel: o build
 * executa em todo preview deployment e migraria o banco errado se as variaveis
 * escorregarem. Alem disso, build interrompido no meio de uma migration deixa
 * schema e codigo dessincronizados sem rollback.
 */
async function main() {
  // Estado legitimo: repo recem-clonado, antes da primeira migration existir.
  // Sem este guard o drizzle joga um stack trace de "Can't find _journal.json".
  if (!existsSync(`${MIGRATIONS_FOLDER}/meta/_journal.json`)) {
    console.log("Nenhuma migration gerada ainda. Rode `pnpm db:generate` primeiro.");
    return;
  }

  const url = requireUrl("direct");
  const pool = new Pool({ connectionString: url, max: 1 });

  try {
    const host = new URL(url).hostname;
    console.log(`Aplicando migrations em ${host}...`);
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
    console.log("Migrations aplicadas.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
