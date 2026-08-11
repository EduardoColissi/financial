import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { accounts, categories, creditCards, investmentSectors } from "@/db/schema";
import { firstDayOf, monthOf, type PlainDate, type RefMonth } from "@/domain/period";
import { CATEGORY_KINDS } from "@/domain/registry";
import type { AppContext } from "./context";

/**
 * O que o modal de novo lancamento precisa saber para se desenhar.
 *
 * Categoria, conta e cartao sao DADO, nao constante: o design crava as cinco
 * contas e os onze nomes de categoria no HTML (linhas 1532-1533), e por isso
 * criar uma categoria nova nao a faz aparecer no modal.
 */

export interface OptionRow {
  id: string;
  name: string;
  color: string;
}

export interface CategoryOption extends OptionRow {
  kind: "expense" | "income" | "investment";
}

/**
 * O cartao leva o ciclo junto.
 *
 * A previa promete em que mes o gasto vai pesar, e no credito isso e' o mes do
 * vencimento da fatura — que depende do fechamento. Sem esses tres campos o
 * modal diria "agosto" para uma compra que so' e' paga em setembro.
 */
export interface CardOption extends OptionRow {
  closingDay: number;
  dueDay: number;
  bestDayOverride: number | null;
}

export interface EntryFormOptions {
  categories: CategoryOption[];
  accounts: OptionRow[];
  cards: CardOption[];
  /** Destinos de aporte. Ocupam o lugar da categoria quando o tipo e' aporte. */
  sectors: OptionRow[];
  /** Data ja' preenchida no formulario. */
  defaultDate: PlainDate;
}

/**
 * Data sugerida: hoje quando se esta' olhando o mes corrente, dia 1 caso
 * contrario.
 *
 * Abrir marco de 2027 e o formulario oferecer "hoje" faria o lancamento cair num
 * mes que nao e' o que esta' na tela — e o usuario so' descobriria depois de
 * salvar, ao nao encontrar a linha.
 */
export function defaultEntryDate(ctx: AppContext, month: RefMonth): PlainDate {
  return monthOf(ctx.today) === month ? ctx.today : firstDayOf(month);
}

export async function getEntryFormOptions(
  ctx: AppContext,
  month: RefMonth
): Promise<EntryFormOptions> {
  const [cats, accs, cards, sectors] = await Promise.all([
    db
      .select({
        id: categories.id,
        name: categories.name,
        color: categories.color,
        kind: categories.kind,
      })
      .from(categories)
      .where(and(eq(categories.userId, ctx.userId), inArray(categories.kind, [...CATEGORY_KINDS])))
      .orderBy(asc(categories.sortOrder), asc(categories.name)),

    db
      .select({ id: accounts.id, name: accounts.name, color: accounts.color })
      .from(accounts)
      .where(eq(accounts.userId, ctx.userId))
      .orderBy(asc(accounts.sortOrder)),

    db
      .select({
        id: creditCards.id,
        name: creditCards.name,
        color: creditCards.color,
        closingDay: creditCards.closingDay,
        dueDay: creditCards.dueDay,
        bestDayOverride: creditCards.bestDayOverride,
      })
      .from(creditCards)
      .where(eq(creditCards.userId, ctx.userId))
      .orderBy(asc(creditCards.sortOrder)),

    db
      .select({
        id: investmentSectors.id,
        name: investmentSectors.name,
        color: investmentSectors.color,
      })
      .from(investmentSectors)
      .where(eq(investmentSectors.userId, ctx.userId))
      .orderBy(asc(investmentSectors.sortOrder), asc(investmentSectors.name)),
  ]);

  return {
    categories: cats as CategoryOption[],
    accounts: accs,
    cards,
    sectors,
    defaultDate: defaultEntryDate(ctx, month),
  };
}
