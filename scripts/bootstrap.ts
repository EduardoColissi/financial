import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../src/db/schema";
import { accounts, categories, users } from "../src/db/schema";
import { CATEGORIES, SYSTEM_CATEGORIES } from "../src/db/seed-data";
import { isLocal, requireUrl } from "./_shared";

/**
 * Deixa um banco recem-migrado utilizavel.
 *
 * Existe porque `db:seed` e' destrutivo (apaga e recria os dados do design) e
 * por isso recusa banco remoto — sem este script, um Neon migrado nao tem nem
 * usuario, e o login recusa mesmo com todas as variaveis certas na Vercel.
 *
 * O que ele garante: usuario + arvore de categorias. Categoria e' taxonomia
 * (nomes, grupos, cores), nao dinheiro fabricado — vem do `seed-data` mesmo,
 * sem os orcamentos, que sao decisao pessoal. E' o unico cadastro que ainda nao
 * tem tela.
 *
 * Conta e cartao NAO entram aqui por padrao: desde a aba "Contas e cartoes"
 * existir, cadastrar pela tela e' melhor — escolhe tipo, titular, cor e saldo de
 * abertura, com validacao. `--account` continua disponivel para quem esta'
 * preparando um banco remoto sem abrir o painel.
 *
 * Tudo aqui e' aditivo e idempotente: cada peca so' e' criada se faltar. Por
 * isso pode rodar contra producao, ao contrario do seed.
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
    //
    // Busca POR E-MAIL, e nao `findFirst()` sem filtro: o banco local tambem
    // hospeda o usuario do seed (`seed@meucaixa.local`), e um `findFirst()`
    // solto acharia ele — o script diria "ja' existe" e devolveria o id errado.
    const email = arg("email") ?? "dono@meucaixa.local";
    const found = await db.query.users.findFirst({
      where: (t, { sql: raw }) => raw`lower(${t.email}) = lower(${email})`,
    });

    let user = found;
    if (user) {
      console.log(`usuario:    ja' existe (${user.email})`);
    } else {
      const [created] = await db
        .insert(users)
        .values({ email, name: arg("name") ?? "Dono", timezone })
        .returning();
      if (!created) throw new Error("insert de usuario nao retornou linha");
      user = created;
      console.log(`usuario:    criado (${user.email})`);
    }
    const userId = user.id;

    // ── categorias ───────────────────────────────────────────────────────────
    //
    // Planas: `category_groups` saiu. O agrupamento que interessa e' o grafico,
    // que separa as despesas por categoria.
    const existing = await db.query.categories.findMany({
      where: eq(categories.userId, userId),
    });
    const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));

    let created = 0;
    let sortOrder = 0;

    for (const c of CATEGORIES) {
      sortOrder++;
      if (existingNames.has(c.name.toLowerCase())) continue;
      await db.insert(categories).values({
        userId,
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
        name: c.name,
        color: c.color,
        kind: c.kind,
        isSystem: true,
        sortOrder,
      });
      created++;
    }
    console.log(`categorias: ${created} criadas, ${existingNames.size} ja' existiam`);

    // ── conta (opcional) ─────────────────────────────────────────────────────
    //
    // So' cria se `--account` for passado. Ha' tela para conta e cartao agora
    // (aba Cadastros), e cadastrar pela tela e' melhor: escolhe cor, tipo e
    // titular. Este caminho ficou para quem prepara um
    // banco remoto por linha de comando.
    const nomeConta = arg("account");
    const anyAccount = await db.query.accounts.findFirst({ where: eq(accounts.userId, userId) });
    if (!nomeConta) {
      console.log('conta:      pulada (cadastre pela aba "Contas e cartões")');
    } else if (anyAccount) {
      console.log(`conta:      ja' existe (${anyAccount.name})`);
    } else {
      const name = nomeConta;
      await db.insert(accounts).values({
        userId,
        name,
        type: "checking",
        initials: initialsFrom(name),
        color: "oklch(0.78 0.16 300)",
        includeInCashTotal: true,
        sortOrder: 0,
      });
      console.log(`conta:      criada (${name})`);
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
