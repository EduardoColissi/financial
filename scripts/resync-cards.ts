import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { linkChargesToStatements, resyncCardStatements } from "../src/db/materialize";
import * as schema from "../src/db/schema";
import { cycleOfRefMonth } from "../src/domain/card-cycle";
import { refMonth } from "../src/domain/period";
import { requireUrl } from "./_shared";

/**
 * Realinha as faturas ao ciclo que cada cartao tem hoje.
 *
 * Duas coisas deixam fatura gravada fora do ciclo: o dia de fechamento ser
 * editado depois de os meses terem sido materializados, e a propria regra do
 * ciclo ter mudado no codigo. Nos dois casos a fatura descreve um recorte que o
 * cartao nao tem mais, e a cobranca de regra — que acha fatura por DATA dentro
 * do periodo — cai na errada, enquanto a compra avulsa, que resolve pelo ciclo
 * atual, cai na certa. Duas despesas do mesmo dia em meses diferentes.
 *
 * Roda por comando explicito e nao no build, como todo script que escreve. E'
 * idempotente: uma segunda passagem nao acha o que corrigir.
 *
 * `--dry` lista o que mudaria sem gravar.
 */

async function main() {
  const dry = process.argv.includes("--dry");
  const url = requireUrl("direct");
  const pool = new Pool({
    connectionString: url,
    max: 1,
    // Neon exige TLS; o host local costuma nao ter certificado.
    ssl: url.includes("localhost") ? undefined : { rejectUnauthorized: false },
  });
  const db = drizzle(pool, { schema });

  try {
    console.log(`Banco: ${new URL(url).hostname}`);
    console.log(dry ? "Modo:  SIMULACAO (nada e' gravado)\n" : "Modo:  APLICAR\n");

    const { rows } = await pool.query<{
      user_id: string;
      card: string;
      closing_day: number;
      due_day: number;
      best_day_override: number | null;
      fatura: string;
      period_start: string;
      period_end: string;
      due_date: string;
      cobrancas: string;
      lancamentos: string;
    }>(`
      select c.user_id, c.name as card, c.closing_day, c.due_day, c.best_day_override,
             to_char(st.ref_month,'YYYY-MM') as fatura,
             to_char(st.period_start,'YYYY-MM-DD') as period_start,
             to_char(st.period_end,'YYYY-MM-DD') as period_end,
             to_char(st.due_date,'YYYY-MM-DD') as due_date,
             (select count(*) from scheduled_charges sc where sc.statement_id = st.id)::text as cobrancas,
             (select count(*) from transactions t where t.statement_id = st.id)::text as lancamentos
        from card_statements st
        join credit_cards c on c.id = st.card_id
       where st.status <> 'paid'
       order by c.name, st.ref_month
    `);

    // O mesmo `cycleOfRefMonth` que o resync usa: a simulacao nao pode prever
    // por uma conta e o reparo gravar por outra.
    const br = (iso: string) => iso.split("-").reverse().join("/");
    const fora = rows.filter((r) => {
      const c = cycleOfRefMonth(
        {
          closingDay: r.closing_day,
          dueDay: r.due_day,
          bestDayOverride: r.best_day_override,
        },
        refMonth(r.fatura)
      );
      return (
        c.periodStart !== r.period_start || c.periodEnd !== r.period_end || c.dueDate !== r.due_date
      );
    });

    console.log(`${rows.length} fatura(s) em aberto · ${fora.length} fora do ciclo do cartao\n`);

    for (const r of fora) {
      const c = cycleOfRefMonth(
        {
          closingDay: r.closing_day,
          dueDay: r.due_day,
          bestDayOverride: r.best_day_override,
        },
        refMonth(r.fatura)
      );
      console.log(
        `  ${r.card} · fatura ${r.fatura}  (cartao fecha ${r.closing_day}, vence ${r.due_day})`
      );
      console.log(`      de: ${br(r.period_start)} a ${br(r.period_end)}  vence ${br(r.due_date)}`);
      console.log(
        `     para: ${br(c.periodStart)} a ${br(c.periodEnd)}  vence ${br(c.dueDate)}` +
          `   · ${r.cobrancas} cobranca(s), ${r.lancamentos} lancamento(s) reavaliados`
      );
    }

    if (fora.length === 0) {
      console.log("Nada a corrigir: toda fatura em aberto ja' descreve o ciclo do cartao.");
      return;
    }

    if (dry) {
      console.log("\nSimulacao: nada foi gravado.");
      return;
    }

    const users = [...new Set(rows.map((r) => r.user_id))];
    let total = 0;
    for (const userId of users) {
      total += await resyncCardStatements(db, { userId });
      // Cobranca que passou a pedir uma fatura ainda inexistente.
      await linkChargesToStatements(db, { userId });
    }

    console.log(`\n${total} fatura(s) realinhada(s).`);

    const depois = await pool.query<{ card: string; fatura: string; linha: string }>(`
      select c.name as card, to_char(st.ref_month,'YYYY-MM') as fatura,
             to_char(st.period_start,'DD/MM/YYYY') || ' a ' || to_char(st.period_end,'DD/MM/YYYY')
               || '  vence ' || to_char(st.due_date,'DD/MM/YYYY') as linha
        from card_statements st
        join credit_cards c on c.id = st.card_id
       where st.status <> 'paid'
       order by c.name, st.ref_month
    `);
    console.log("\nDepois:");
    for (const r of depois.rows) {
      console.log(`  ${r.card.padEnd(18)} ${r.fatura}  ${r.linha}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
