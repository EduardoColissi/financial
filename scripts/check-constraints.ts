import { Pool } from "pg";
import { assertLocalOrExit, requireUrl } from "./_shared";

/**
 * Prova que os CHECKs do schema RECUSAM os casos invalidos.
 *
 * Escrever a constraint nao e' o mesmo que ela funcionar: um `check()` com
 * expressao errada, ou comparando enum com literal que o Postgres aceita de
 * forma inesperada, passa despercebido ate' o dado sujo entrar. Cada caso aqui
 * TEM que falhar; se algum passar, o schema esta' furado.
 */

type Caso = { nome: string; sql: string; params?: unknown[] };

async function main() {
  const url = requireUrl("direct");
  assertLocalOrExit(url, "check-constraints (insere e remove dados)");

  const pool = new Pool({ connectionString: url, max: 1 });
  let falhas = 0;

  try {
    // Dados minimos validos para pendurar os casos invalidos.
    const { rows } = await pool.query<{ id: string }>(
      `insert into users (email, name) values ('teste@local', 'Teste') returning id`
    );
    const userId = rows[0]?.id;
    if (!userId) throw new Error("nao criou usuario");

    const conta = (
      await pool.query<{ id: string }>(
        `insert into accounts (user_id, name, type, initials, color, opening_balance_on)
         values ($1, 'Conta', 'checking', 'CT', 'oklch(0.8 0.1 168)', '2026-01-01') returning id`,
        [userId]
      )
    ).rows[0]?.id;

    const cartao = (
      await pool.query<{ id: string }>(
        `insert into credit_cards (user_id, name, brand, limit_cents, closing_day, due_day, color)
         values ($1, 'Cartao', 'Visa', 500000, 28, 5, 'oklch(0.8 0.1 300)') returning id`,
        [userId]
      )
    ).rows[0]?.id;

    const grupo = (
      await pool.query<{ id: string }>(
        `insert into category_groups (user_id, name, color)
         values ($1, 'Essencial', 'oklch(0.84 0.16 158)') returning id`,
        [userId]
      )
    ).rows[0]?.id;

    const categoria = (
      await pool.query<{ id: string }>(
        `insert into categories (user_id, group_id, name, color, kind)
         values ($1, $2, 'Moradia', 'oklch(0.84 0.16 158)', 'expense') returning id`,
        [userId, grupo]
      )
    ).rows[0]?.id;

    const casos: Caso[] = [
      {
        nome: "categoria duplicada ignorando maiusculas",
        sql: `insert into categories (user_id, group_id, name, color, kind)
              values ($1, $2, 'MORADIA', 'oklch(0.8 0.1 0)', 'expense')`,
        params: [userId, grupo],
      },
      {
        nome: "categoria de despesa sem grupo",
        sql: `insert into categories (user_id, name, color, kind)
              values ($1, 'Sem grupo', 'oklch(0.8 0.1 0)', 'expense')`,
        params: [userId],
      },
      {
        nome: "cartao com dia de fechamento 32",
        sql: `insert into credit_cards (user_id, name, brand, limit_cents, closing_day, due_day, color)
              values ($1, 'Invalido', 'Visa', 100000, 32, 5, 'oklch(0.8 0.1 0)')`,
        params: [userId],
      },
      {
        nome: "valor negativo (a direcao vem do kind, nunca do sinal)",
        sql: `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, account_id, category_id)
              values ($1,'expense','2026-08-01','2026-08-01','x',-100,'pix',$2,$3)`,
        params: [userId, conta, categoria],
      },
      {
        nome: "valor zero",
        sql: `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, account_id, category_id)
              values ($1,'expense','2026-08-01','2026-08-01','x',0,'pix',$2,$3)`,
        params: [userId, conta, categoria],
      },
      {
        nome: "competencia que nao e' dia 1",
        sql: `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, account_id, category_id)
              values ($1,'expense','2026-08-15','2026-08-15','x',100,'pix',$2,$3)`,
        params: [userId, conta, categoria],
      },
      {
        nome: "transferencia COM categoria",
        sql: `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, account_id, transfer_account_id, category_id)
              values ($1,'transfer','2026-08-01','2026-08-01','x',100,'transfer',$2,$2,$3)`,
        params: [userId, conta, categoria],
      },
      {
        nome: "despesa SEM categoria",
        sql: `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, account_id)
              values ($1,'expense','2026-08-01','2026-08-01','x',100,'pix',$2)`,
        params: [userId, conta],
      },
      {
        nome: "cartao preenchido mas metodo != credito",
        sql: `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, card_id, category_id)
              values ($1,'expense','2026-08-01','2026-08-01','x',100,'pix',$2,$3)`,
        params: [userId, cartao, categoria],
      },
      {
        nome: "metodo credito sem cartao",
        sql: `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, account_id, category_id)
              values ($1,'expense','2026-08-01','2026-08-01','x',100,'credit',$2,$3)`,
        params: [userId, conta, categoria],
      },
      {
        nome: "despesa com conta E cartao ao mesmo tempo",
        sql: `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, account_id, card_id, category_id)
              values ($1,'expense','2026-08-01','2026-08-01','x',100,'credit',$2,$3,$4)`,
        params: [userId, conta, cartao, categoria],
      },
      {
        nome: "receita lancada no cartao",
        sql: `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, card_id, category_id)
              values ($1,'income','2026-08-01','2026-08-01','x',100,'credit',$2,$3)`,
        params: [userId, cartao, categoria],
      },
      {
        nome: "parcela sem total",
        sql: `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, card_id, category_id, installment_seq)
              values ($1,'expense','2026-08-01','2026-08-01','x',100,'credit',$2,$3,1)`,
        params: [userId, cartao, categoria],
      },
      {
        nome: "parcela 11 de 10",
        sql: `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, card_id, category_id, installment_seq, installment_total)
              values ($1,'expense','2026-08-01','2026-08-01','x',100,'credit',$2,$3,11,10)`,
        params: [userId, cartao, categoria],
      },
      {
        nome: "fatura paga sem data de pagamento",
        sql: `insert into card_statements (user_id, card_id, ref_month, period_start, period_end, due_date, status)
              values ($1,$2,'2026-09-01','2026-07-29','2026-08-28','2026-09-05','paid')`,
        params: [userId, cartao],
      },
      {
        nome: "fatura com periodo invertido",
        sql: `insert into card_statements (user_id, card_id, ref_month, period_start, period_end, due_date)
              values ($1,$2,'2026-09-01','2026-08-28','2026-07-29','2026-09-05')`,
        params: [userId, cartao],
      },
      {
        nome: "duas faturas do mesmo cartao no mesmo mes",
        sql: `insert into card_statements (user_id, card_id, ref_month, period_start, period_end, due_date)
              values ($1,$2,'2026-10-01','2026-08-29','2026-09-28','2026-10-05'),
                     ($1,$2,'2026-10-01','2026-08-29','2026-09-28','2026-10-05')`,
        params: [userId, cartao],
      },
    ];

    for (const caso of casos) {
      try {
        await pool.query(caso.sql, caso.params as never);
        console.error(`  FALHOU: "${caso.nome}" foi ACEITO e deveria ter sido recusado`);
        falhas++;
      } catch {
        console.log(`  ok: recusou "${caso.nome}"`);
      }
    }

    // Um caso valido tem que passar, senao o teste nao prova nada.
    await pool.query(
      `insert into transactions (user_id, kind, occurred_on, competence_month, description, amount_cents, method, account_id, category_id)
       values ($1,'expense','2026-08-01','2026-08-01','Aluguel',220000,'pix',$2,$3)`,
      [userId, conta, categoria]
    );
    console.log("  ok: aceitou o lancamento valido");

    // Limpa tudo.
    await pool.query("delete from users where id = $1", [userId]);
  } finally {
    await pool.end();
  }

  if (falhas > 0) {
    console.error(`\n${falhas} constraint(s) nao estao funcionando.`);
    process.exit(1);
  }
  console.log("\nTodos os CHECKs recusaram o que deviam.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
