import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * Um unico driver: `pg` (node-postgres), local e em producao.
 *
 * O Neon oferece `neon-http`, que e' mais rapido em cold start, mas nao suporta
 * transacao interativa — e a materializacao de mes precisa de uma (advisory
 * lock + inserts dependentes no mesmo escopo). Manter dois drivers resolveria,
 * ao custo de o Postgres local nao exercitar o mesmo caminho de codigo que a
 * producao: e' a classe de bug que so aparece depois do deploy, e este projeto
 * nao tem staging.
 *
 * `max: 1` porque em serverless cada instancia abre o proprio pool; o
 * enfileiramento real acontece no pooler do Neon (use a string com `-pooler`
 * no runtime, e a direta apenas nas migrations).
 */
const globalForDb = globalThis as unknown as { __financialPool?: Pool };

const pool =
  globalForDb.__financialPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

// Reaproveita o pool entre recargas do HMR; sem isso o dev vaza conexoes
// ate' estourar o limite do banco.
if (env.NODE_ENV !== "production") globalForDb.__financialPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
