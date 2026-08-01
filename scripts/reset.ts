import { Pool } from "pg";
import { assertLocalOrExit, requireUrl } from "./_shared";

/**
 * Derruba o schema inteiro e reconstroi. E' o comando mais usado enquanto o
 * modelo de dados ainda esta' se formando — e por isso mesmo o mais perigoso.
 * Nao roda contra banco remoto, em hipotese nenhuma (ver assertLocalOrExit).
 */
async function main() {
  const url = requireUrl("direct");
  assertLocalOrExit(url, "db:reset");

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    console.log("Derrubando o schema public...");
    await pool.query("drop schema if exists public cascade");
    await pool.query("create schema public");
    console.log("Schema recriado. Rode `pnpm db:migrate` e `pnpm db:seed`.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
