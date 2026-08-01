import { Pool } from "pg";
import { requireUrl } from "./_shared";

/**
 * Esqueleto. O seed de verdade entra no passo 9 do plano, transcrevendo os
 * dados do design ja' em centavos e aplicando os mapas de deduplicacao — no
 * mock a mesma obrigacao aparece em ate' tres lugares (TX, RECS e
 * CARDS[].parcelas), e modelar aquilo ao pe' da letra geraria lancamento triplo.
 *
 * Precisa ser idempotente: rodar duas vezes nao pode duplicar nada.
 */
async function main() {
  const url = requireUrl("direct");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<{ now: string }>("select now()::text as now");
    console.log(`Conectado (${rows[0]?.now}). Seed ainda nao implementado — passo 9.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
