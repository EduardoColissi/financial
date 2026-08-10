import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { materializeMonth } from "../src/db/materialize";
import * as schema from "../src/db/schema";
import { addMonths, monthOf, todayInTimeZone } from "../src/domain/period";
import { assertLocalOrExit, requireUrl } from "./_shared";

/**
 * Prova a idempotencia da materializacao de mes.
 *
 * E' o ponto de maior risco do sistema: um erro aqui duplica faturas e
 * cobrancas em silencio — nada quebra, os numeros so' ficam errados. Escrever
 * `ON CONFLICT DO NOTHING` nao prova nada; rodar concorrente, prova.
 */
async function main() {
  const url = requireUrl("direct");
  assertLocalOrExit(url, "check-materialize");

  const pool = new Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  let falhas = 0;

  try {
    const user = await db.query.users.findFirst();
    if (!user) {
      console.error("Rode `pnpm db:seed` antes.");
      process.exit(1);
    }
    const target = { userId: user.id };

    const contar = async () => {
      const r = await db.execute<{ statements: string; charges: string }>(sql`
        select (select count(*) from card_statements where user_id = ${user.id})::text as statements,
               (select count(*) from scheduled_charges where user_id = ${user.id})::text as charges
      `);
      return {
        statements: Number(r.rows[0]?.statements ?? 0),
        charges: Number(r.rows[0]?.charges ?? 0),
      };
    };

    // O mes corrente, que e' onde o seed poe os dados — cravar uma data aqui
    // faria a prova rodar, com o tempo, num mes vazio.
    const mes = monthOf(todayInTimeZone(user.timezone));

    // Aquece antes de contar. A materializacao tambem cria a fatura do ciclo em
    // que cada assinatura cai, que costuma ser a do mes seguinte — trabalho
    // legitimo da PRIMEIRA execucao. Contar antes dele acusaria como duplicata
    // o que e' so' a geracao inicial.
    await materializeMonth(db, target, mes);

    const antes = await contar();
    console.log(`Antes:  ${antes.statements} faturas, ${antes.charges} cobrancas`);

    // 10 materializacoes simultaneas do MESMO mes. Sem o advisory lock e o
    // UNIQUE, aqui e' onde a duplicata apareceria.
    await Promise.all(Array.from({ length: 10 }, () => materializeMonth(db, target, mes)));

    const depois = await contar();
    console.log(`Depois: ${depois.statements} faturas, ${depois.charges} cobrancas`);

    if (depois.statements !== antes.statements || depois.charges !== antes.charges) {
      console.error("  ERRO: 10 chamadas concorrentes ALTERARAM a contagem");
      falhas++;
    } else {
      console.log("  ok: 10 chamadas concorrentes do mesmo mes nao duplicaram nada");
    }

    // Gerar um mes distante SEM ter gerado os intermediarios tem que produzir a
    // sequencia de parcela correta — e' o que torna a geracao funcional.
    const distante = addMonths(mes, 6);
    await materializeMonth(db, target, distante);
    const salto = await db.execute<{ name: string; sequence: number | null }>(sql`
      select rr.name, sc.sequence
        from scheduled_charges sc
        join recurring_rules rr on rr.id = sc.rule_id
       where sc.user_id = ${user.id}
         and sc.ref_month = ${`${distante}-01`}
         and rr.installments_total is not null
       order by rr.name
    `);
    console.log(`\nMes ${distante} gerado sem os intermediarios:`);
    for (const row of salto.rows) {
      console.log(`  ${row.name}: parcela ${row.sequence}`);
    }

    // "Notebook Dell" comeca em 2026-04 com 10 parcelas. Em 2027-02 seria a 11a,
    // ou seja, ja' terminou e nao pode aparecer.
    const notebook = salto.rows.find((r) => r.name === "Notebook Dell");
    if (notebook) {
      console.error("  ERRO: parcelamento encerrado ainda gerando cobranca");
      falhas++;
    } else {
      console.log("  ok: parcelamento encerrado nao gera cobranca");
    }

    // Rodar de novo o mes distante tambem tem que ser no-op.
    const antesRepeat = await contar();
    await materializeMonth(db, target, distante);
    const depoisRepeat = await contar();
    if (depoisRepeat.charges !== antesRepeat.charges) {
      console.error("  ERRO: reabrir o mes duplicou cobrancas");
      falhas++;
    } else {
      console.log("  ok: reabrir o mes e' no-op");
    }
  } finally {
    await pool.end();
  }

  if (falhas > 0) {
    console.error(`\n${falhas} problema(s) de idempotencia.`);
    process.exit(1);
  }
  console.log("\nMaterializacao idempotente.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
