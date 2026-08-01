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

    /**
     * O journal de migrations do drizzle NAO mora em `public` — fica em
     * `drizzle.__drizzle_migrations`. Derrubar so' o `public` deixava o journal
     * intacto, e o `db:migrate` seguinte reportava "Migrations aplicadas" sobre
     * um banco VAZIO. Falha silenciosa: tudo verde, nada criado.
     */
    console.log("Derrubando o journal de migrations...");
    await pool.query("drop schema if exists drizzle cascade");

    console.log("Schema recriado. Rode `pnpm db:migrate` e `pnpm db:seed`.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
