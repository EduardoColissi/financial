import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { users } from "../src/db/schema";
import { isLocal, requireUrl } from "./_shared";

/**
 * Cria o usuario unico num banco vazio.
 *
 * Existe porque `db:seed` e' destrutivo (apaga e recria os dados do design) e
 * por isso recusa banco remoto — sem este script, um Neon recem-migrado nao tem
 * nenhuma linha em `users`, e o login responde "gate nao configurado" mesmo com
 * todas as variaveis certas na Vercel.
 *
 * O que ele faz e' aditivo e idempotente: se ja' houver usuario, so' imprime o
 * id e sai sem tocar em nada. Por isso pode rodar contra producao, ao contrario
 * do seed.
 *
 * As demais tabelas ficam vazias de proposito. `app_settings` e' opcional
 * (`getContext` cai nos defaults) e o painel renderiza mes vazio sem quebrar —
 * o resto voce cria pela propria interface.
 */

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const url = requireUrl("direct");
  const host = new URL(url).hostname;

  // O alvo vai gritado na tela: o erro caro aqui nao e' rodar o script, e' roda-lo
  // apontando para a branch errada do Neon achando que e' a outra.
  console.log(`Alvo: ${host}${isLocal(url) ? " (local)" : " (REMOTO)"}`);

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });

  try {
    const existing = await db.query.users.findFirst();
    if (existing) {
      console.log(`\nJa' existe usuario. Nada a fazer.\n\nSINGLE_USER_ID=${existing.id}`);
      return;
    }

    const email = arg("email") ?? "dono@meucaixa.local";
    const name = arg("name") ?? "Dono";
    const timezone = arg("timezone") ?? process.env.APP_TIMEZONE ?? "America/Sao_Paulo";

    const [created] = await db.insert(users).values({ email, name, timezone }).returning();
    if (!created) throw new Error("insert nao retornou linha");

    console.log(
      `\nUsuario criado: ${created.name} <${created.email}>, fuso ${created.timezone}.\n\n` +
        `SINGLE_USER_ID=${created.id}\n\n` +
        `Esta variavel e' opcional na Vercel: sem ela o login usa o primeiro usuario,\n` +
        `que e' este. Vale declarar so' se algum dia houver uma segunda linha.`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
