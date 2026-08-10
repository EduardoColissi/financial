import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { linkChargesToStatements } from "../src/db/materialize";
import * as schema from "../src/db/schema";
import { requireUrl } from "./_shared";

/**
 * Audita — e, com `--apply`, corrige — cobrancas de cartao sem fatura.
 *
 * Uma assinatura cobrada depois do fechamento cai na fatura do mes SEGUINTE.
 * Enquanto a materializacao so' ligava cobranca a fatura JA' existente, essa
 * fatura podia ainda nao ter sido criada: a cobranca nascia sem `statement_id`
 * e nenhuma abertura de mes posterior voltava para resgata-la. O efeito e'
 * silencioso e caro — a cobranca some do total da fatura, e a fatura e' paga a
 * menos do que o cartao vai cobrar.
 *
 * Roda contra qualquer banco, inclusive remoto: nao apaga nada e nao altera
 * nenhum vinculo existente, apenas preenche o que esta' nulo. Ainda assim o
 * padrao e' so' relatar — `--apply` e' explicito de proposito.
 */
async function main() {
  const apply = process.argv.includes("--apply");
  const url = requireUrl("direct");
  const host = new URL(url).hostname;

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });

  try {
    console.log(`Banco: ${host}\nModo:  ${apply ? "APLICAR correcao" : "somente relatorio"}\n`);

    const orfas = await db.execute<{
      user_id: string;
      name: string;
      ref_month: string;
      due_date: string;
      amount_cents: string;
      card_name: string;
      closing_day: number;
    }>(sql`
      select sc.user_id, rr.name, to_char(sc.ref_month,'YYYY-MM') as ref_month,
             to_char(sc.due_date,'DD/MM/YYYY') as due_date, sc.amount_cents::text,
             cc.name as card_name, cc.closing_day
        from scheduled_charges sc
        join recurring_rules rr on rr.id = sc.rule_id
        join credit_cards cc on cc.id = rr.card_id
       where sc.statement_id is null and sc.status <> 'skipped'
       order by sc.due_date
    `);

    if (orfas.rows.length === 0) {
      console.log("Nenhuma cobranca de cartao sem fatura. Nada a corrigir.");
      return;
    }

    console.log(`${orfas.rows.length} cobranca(s) de cartao sem fatura:\n`);
    let totalCents = 0;
    for (const r of orfas.rows) {
      const valor = Number(r.amount_cents);
      totalCents += valor;
      console.log(
        `  ${r.due_date}  ${r.name.padEnd(24)} ${(valor / 100).toFixed(2).padStart(10)}` +
          `  ${r.card_name} (fecha dia ${r.closing_day}, competência ${r.ref_month})`
      );
    }
    console.log(`\n  total fora das faturas: R$ ${(totalCents / 100).toFixed(2)}`);

    if (!apply) {
      console.log("\nRode de novo com --apply para ligar cada uma a' fatura do seu ciclo.");
      return;
    }

    // Um usuario por vez: o vinculo e' feito por dono, como no app.
    const usuarios = [...new Set(orfas.rows.map((r) => r.user_id))];
    for (const userId of usuarios) {
      await linkChargesToStatements(db, { userId });
    }

    const restantes = await db.execute<{ n: string }>(sql`
      select count(*)::text as n from scheduled_charges
       where statement_id is null and status <> 'skipped'
         and rule_id in (select id from recurring_rules where card_id is not null)
    `);
    const sobrou = Number(restantes.rows[0]?.n ?? 0);
    console.log(
      sobrou === 0
        ? "\nTodas ligadas a' fatura do ciclo correspondente."
        : `\nAINDA sobraram ${sobrou} — investigar antes de seguir.`
    );
    if (sobrou > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
