import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { accounts, categories, categoryGroups, users } from "../src/db/schema";
import { CATEGORIES, GROUPS, SYSTEM_CATEGORIES } from "../src/db/seed-data";
import { todayInTimeZone } from "../src/domain/period";
import { isLocal, requireUrl } from "./_shared";

/**
 * Deixa um banco recem-migrado utilizavel.
 *
 * Existe porque `db:seed` e' destrutivo (apaga e recria os dados do design) e
 * por isso recusa banco remoto — sem este script, um Neon migrado nao tem nem
 * usuario, e o login recusa mesmo com todas as variaveis certas na Vercel.
 *
 * So' o usuario nao basta, e essa e' a parte que nao era obvia: as unicas acoes
 * de escrita que existem hoje sao entrar e criar lancamento, e criar lancamento
 * EXIGE uma conta e uma categoria ja' cadastradas. Nao ha' tela para cadastrar
 * nenhuma das duas. Um banco so' com o usuario abre o painel e nao deixa fazer
 * nada.
 *
 * Entao o minimo utilizavel e': usuario + arvore de categorias + uma conta.
 * Categoria e' taxonomia (nomes, grupos, cores), nao dinheiro fabricado — vem
 * do `seed-data` mesmo, sem os orcamentos, que sao decisao pessoal. A conta
 * nasce com o nome e o saldo de abertura que voce passar.
 *
 * Tudo aqui e' aditivo e idempotente: cada peca so' e' criada se faltar. Por
 * isso pode rodar contra producao, ao contrario do seed. Cartao de credito
 * continua sem caminho — nao ha' tela nem script para ele ainda.
 */

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

/** "Nubank Conta" -> "NU". So' letras, para caber no circulo do avatar. */
function initialsFrom(name: string): string {
  const words = name
    .replace(/[^\p{L}\s]/gu, " ")
    .trim()
    .split(/\s+/);
  const first = words[0] || "Conta";
  return (first.length >= 2 ? first.slice(0, 2) : first).toUpperCase();
}

async function main() {
  const url = requireUrl("direct");
  const host = new URL(url).hostname;

  // O alvo vai gritado na tela: o erro caro aqui nao e' rodar o script, e' roda-lo
  // apontando para a branch errada do Neon achando que e' a outra.
  console.log(`Alvo: ${host}${isLocal(url) ? " (local)" : " (REMOTO)"}\n`);

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });

  try {
    const timezone = arg("timezone") ?? process.env.APP_TIMEZONE ?? "America/Sao_Paulo";

    // ── usuario ──────────────────────────────────────────────────────────────
    const found = await db.query.users.findFirst();
    let user = found;
    if (user) {
      console.log(`usuario:    ja' existe (${user.email})`);
    } else {
      const [created] = await db
        .insert(users)
        .values({
          email: arg("email") ?? "dono@meucaixa.local",
          name: arg("name") ?? "Dono",
          timezone,
        })
        .returning();
      if (!created) throw new Error("insert de usuario nao retornou linha");
      user = created;
      console.log(`usuario:    criado (${user.email})`);
    }
    const userId = user.id;

    // ── grupos de categoria ──────────────────────────────────────────────────
    const groupIdByName = new Map<string, string>();
    for (const g of GROUPS) {
      const existing = await db.query.categoryGroups.findFirst({
        where: (t, { and, eq: e, sql: raw }) =>
          and(e(t.userId, userId), raw`lower(${t.name}) = lower(${g.name})`),
      });
      if (existing) {
        groupIdByName.set(g.name, existing.id);
        continue;
      }
      const [created] = await db
        .insert(categoryGroups)
        .values({ userId, name: g.name, color: g.color, sortOrder: g.sortOrder })
        .returning();
      if (!created) throw new Error(`insert do grupo ${g.name} nao retornou linha`);
      groupIdByName.set(g.name, created.id);
    }
    console.log(`grupos:     ${groupIdByName.size}`);

    // ── categorias ───────────────────────────────────────────────────────────
    //
    // `categories_group_ck` exige: despesa TEM grupo, receita e investimento NAO
    // tem. Por isso as duas listas entram por caminhos diferentes.
    const existing = await db.query.categories.findMany({
      where: eq(categories.userId, userId),
    });
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));

    let created = 0;
    let sortOrder = 0;

    for (const c of CATEGORIES) {
      sortOrder++;
      if (existingNames.has(c.name.toLowerCase())) continue;
      const groupId = groupIdByName.get(c.group);
      if (!groupId) throw new Error(`grupo ${c.group} nao encontrado para ${c.name}`);
      await db.insert(categories).values({
        userId,
        groupId,
        name: c.name,
        color: c.color,
        kind: "expense",
        // Orcamento e' decisao pessoal, nao taxonomia: producao nasce sem.
        monthlyBudgetCents: null,
        sortOrder,
      });
      created++;
    }

    for (const c of SYSTEM_CATEGORIES) {
      sortOrder++;
      if (existingNames.has(c.name.toLowerCase())) continue;
      await db.insert(categories).values({
        userId,
        groupId: null,
        name: c.name,
        color: c.color,
        kind: c.kind,
        isSystem: true,
        sortOrder,
      });
      created++;
    }
    console.log(`categorias: ${created} criadas, ${existingNames.size} ja' existiam`);

    // ── conta ────────────────────────────────────────────────────────────────
    const anyAccount = await db.query.accounts.findFirst({ where: eq(accounts.userId, userId) });
    if (anyAccount) {
      console.log(`conta:      ja' existe (${anyAccount.name})`);
    } else {
      const name = arg("account") ?? "Conta corrente";
      const opening = Number(arg("opening") ?? "0");
      if (!Number.isInteger(opening)) {
        throw new Error("--opening e' em CENTAVOS inteiros (R$ 1.234,50 => 123450)");
      }
      await db.insert(accounts).values({
        userId,
        name,
        type: "checking",
        initials: initialsFrom(name),
        color: "oklch(0.78 0.16 300)",
        openingBalanceCents: opening,
        openingBalanceOn: todayInTimeZone(timezone),
        includeInCashTotal: true,
        sortOrder: 0,
      });
      console.log(`conta:      criada (${name}, abertura ${opening} centavos)`);
    }

    console.log(
      `\nPronto.\n\nSINGLE_USER_ID=${userId}\n\n` +
        `Opcional na Vercel: sem ela o login usa o primeiro usuario, que e' este.`
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
