import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { remainingIncludingCurrent } from "@/domain/installments";
import { type Cents, cents } from "@/domain/money";
import {
  addDays,
  daysBetween,
  daysInMonth,
  firstDayOf,
  firstWeekdayOf,
  type PlainDate,
  partsOfDate,
  plainDate,
  type RefMonth,
} from "@/domain/period";
import { type ChargePhase, chargePhase, chargePhaseTone, type Tone } from "@/domain/status";
import type { AppContext } from "./context";
import { ensureMonthMaterialized } from "./materialize";

/**
 * Cobrancas agendadas — alimenta as abas "Contas a pagar" e "Assinaturas".
 *
 * As duas leem a MESMA entidade. O que as separa e' o canal de pagamento
 * (conta/boleto x cartao), nao "fixa x parcelada" como o design sugere ao ter
 * duas listas independentes.
 *
 * E' tambem o que faz cada aba recortar o mes de um jeito. Uma conta em boleto
 * e' paga no dia em que vence, entao o mes dela e' o mes do vencimento. Uma
 * assinatura no cartao nao: ela e' cobrada num dia e paga junto com a fatura,
 * que pode vencer no mes seguinte. Num cartao que fecha dia 05, a cobranca do
 * dia 15 de agosto so' sai do bolso em setembro — e e' em setembro que ela
 * precisa aparecer, ao lado das outras que serao pagas no mesmo cheque.
 */

export interface ChargeRow {
  id: string;
  name: string;
  dueDate: PlainDate;
  day: number;
  amountCents: Cents;
  paid: boolean;
  fixed: boolean;
  onCredit: boolean;
  categoryName: string;
  categoryColor: string;
  cardName: string | null;
  accountName: string | null;
  sequence: number | null;
  total: number | null;
  remainingCents: Cents | null;
  phase: ChargePhase;
  tone: Tone;
}

export interface BillsResult {
  rows: ChargeRow[];
  totalCents: Cents;
  paidCents: Cents;
  openCents: Cents;
  fixedCents: Cents;
  variableCents: Cents;
  openCount: number;
  paidCount: number;
  /** Grade 6x7 do calendario, ja' com o offset real do dia da semana. */
  calendar: Array<{ key: string; day: number | null; today: boolean; charges: ChargeRow[] }>;
}

export interface SubscriptionsResult {
  rows: ChargeRow[];
  subscriptionsCents: Cents;
  installmentsCents: Cents;
  postedCents: Cents;
  forecastCents: Cents;
  remainingCents: Cents;
  next: ChargeRow | null;
  /** O periodo faturado, dia a dia — nao o mes civil. Ver `buildTimeline`. */
  timeline: Array<{
    key: string;
    day: number;
    label: string;
    today: boolean;
    marks: Array<{ id: string; color: string; posted: boolean }>;
  }>;
}

/**
 * Que recorte de mes a aba usa.
 *
 * `bill` = a cobranca vence neste mes. `statement` = a cobranca cai na fatura
 * que vence neste mes, que e' quando o dinheiro sai.
 */
type ChargeScope = "bill" | "statement";

async function loadCharges(
  ctx: AppContext,
  month: RefMonth,
  scope: ChargeScope
): Promise<ChargeRow[]> {
  // Materializar antes tambem religa cobranca que tenha ficado sem fatura, e e'
  // o que garante que o recorte por fatura nao esconda nada.
  await ensureMonthMaterialized(ctx, month);
  const ref = firstDayOf(month);

  const escopo =
    scope === "bill"
      ? sql`rr.card_id is null and sc.ref_month = ${ref}`
      : sql`st.ref_month = ${ref}`;

  const { rows } = await db.execute<{
    id: string;
    name: string;
    due_date: string;
    amount_cents: string;
    status: string;
    is_variable: boolean;
    card_id: string | null;
    sequence: number | null;
    total: number | null;
    cat_name: string;
    cat_color: string;
    card_name: string | null;
    account_name: string | null;
  }>(sql`
    select sc.id, rr.name, to_char(sc.due_date,'YYYY-MM-DD') as due_date,
           sc.amount_cents::text, sc.status, rr.is_variable, rr.card_id,
           sc.sequence, rr.installments_total as total,
           cat.name as cat_name, cat.color as cat_color,
           cc.name as card_name, ac.name as account_name
      from scheduled_charges sc
      join recurring_rules rr on rr.id = sc.rule_id
      join categories cat on cat.id = rr.category_id
      left join credit_cards cc on cc.id = rr.card_id
      left join accounts ac on ac.id = rr.account_id
      left join card_statements st on st.id = sc.statement_id
     where sc.user_id = ${ctx.userId} and ${escopo}
     order by sc.due_date, rr.name
  `);

  return rows.map((r) => {
    const onCredit = r.card_id != null;
    const paid = r.status === "paid";
    const dueDate = plainDate(r.due_date);
    const phase = chargePhase({ dueDate, paid, onCredit }, ctx.today);
    const amount = cents(Number(r.amount_cents));

    return {
      id: r.id,
      name: r.name,
      dueDate,
      day: partsOfDate(dueDate).day,
      amountCents: amount,
      paid,
      fixed: !r.is_variable,
      onCredit,
      categoryName: r.cat_name,
      categoryColor: r.cat_color,
      cardName: r.card_name,
      accountName: r.account_name,
      sequence: r.sequence,
      total: r.total,
      remainingCents:
        r.sequence != null && r.total != null
          ? remainingIncludingCurrent(amount, r.sequence, r.total)
          : null,
      phase,
      tone: chargePhaseTone(phase),
    };
  });
}

/** Aba "Contas a pagar": o que vence em conta ou boleto. */
export async function getBills(
  ctx: AppContext,
  month: RefMonth,
  filter: "todas" | "fixas" | "variaveis" = "todas"
): Promise<BillsResult> {
  const all = await loadCharges(ctx, month, "bill");

  const visible = all.filter((c) =>
    filter === "todas" ? true : filter === "fixas" ? c.fixed : !c.fixed
  );

  const sum = (list: ChargeRow[]) => cents(list.reduce<number>((a, c) => a + c.amountCents, 0));
  const paidList = all.filter((c) => c.paid);

  // Grade 6x7 com o dia da semana REAL do dia 1. O design crava `i - 5 + 1`,
  // que so' vale para agosto de 2026.
  const offset = firstWeekdayOf(month);
  const total = daysInMonth(month);
  const todayParts = partsOfDate(ctx.today);
  const isCurrentMonth = ctx.today.slice(0, 7) === month;

  const calendar = Array.from({ length: 42 }, (_, i) => {
    const day = i - offset + 1;
    const valid = day >= 1 && day <= total;
    return {
      // Chave estavel derivada do dado, nao do indice: dias validos usam a data
      // real, celulas vazias usam a posicao (que e' o que elas sao).
      key: valid ? `${month}-${String(day).padStart(2, "0")}` : `vazio-${i}`,
      day: valid ? day : null,
      today: valid && isCurrentMonth && day === todayParts.day,
      charges: valid ? visible.filter((c) => c.day === day) : [],
    };
  });

  return {
    rows: visible,
    totalCents: sum(all),
    paidCents: sum(paidList),
    openCents: sum(all.filter((c) => !c.paid)),
    fixedCents: sum(all.filter((c) => c.fixed)),
    variableCents: sum(all.filter((c) => !c.fixed)),
    openCount: all.filter((c) => !c.paid).length,
    paidCount: paidList.length,
    calendar,
  };
}

const isInstallment = (c: ChargeRow) => c.total != null;

/**
 * A faixa de dias que a fatura cobre, do primeiro ao ultimo dia com cobranca.
 *
 * Nao e' o mes civil. Um ciclo que fecha dia 05 comeca no dia 06 do mes
 * anterior, entao a fatura de setembro e' cobrada entre 06/08 e 05/09 — e
 * cartoes com fechamentos diferentes deslocam esse periodo cada um para um
 * lado. Desenhar isso sobre um calendario de 1 a 30 punha a cobranca do dia
 * 06/08 na casa "6" de setembro, um mes inteiro fora do lugar.
 *
 * Deriva o intervalo das proprias cobrancas em vez de pedir os periodos aos
 * cartoes: a aba junta varios cartoes, e o unico intervalo que cabe todos e'
 * aquele que vai da primeira cobranca a' ultima.
 */
function buildTimeline(charges: readonly ChargeRow[], today: PlainDate) {
  const dates = charges.map((c) => c.dueDate).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return [];

  return Array.from({ length: daysBetween(first, last) + 1 }, (_, i) => {
    const date = addDays(first, i);
    const parts = partsOfDate(date);
    return {
      key: date,
      day: parts.day,
      label: `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}`,
      today: date === today,
      marks: charges
        .filter((c) => c.dueDate === date)
        .map((c) => ({
          id: c.id,
          color: isInstallment(c) ? "var(--info-bar)" : c.categoryColor,
          posted: c.phase !== "prevista",
        })),
    };
  });
}

/**
 * Aba "Assinaturas e parcelas": o que cai na fatura que vence neste mes.
 *
 * Recorte por FATURA, nao pelo mes em que a assinatura e' cobrada. As duas
 * coisas divergem em todo cartao — a cobranca posterior ao fechamento pertence
 * a' fatura seguinte —, e listar pelo mes de cobranca mostrava lado a lado
 * despesas que sairiam do bolso em meses diferentes.
 */
export async function getSubscriptions(
  ctx: AppContext,
  month: RefMonth,
  filter: "todos" | "assinaturas" | "parcelas" = "todos"
): Promise<SubscriptionsResult> {
  const all = await loadCharges(ctx, month, "statement");

  const visible = all.filter((c) =>
    filter === "todos" ? true : filter === "assinaturas" ? !isInstallment(c) : isInstallment(c)
  );

  const sum = (list: ChargeRow[]) => cents(list.reduce<number>((a, c) => a + c.amountCents, 0));
  const posted = all.filter((c) => c.phase === "na fatura" || c.paid);
  const forecast = all.filter((c) => c.phase === "prevista");

  return {
    rows: visible,
    subscriptionsCents: sum(all.filter((c) => !isInstallment(c))),
    installmentsCents: sum(all.filter(isInstallment)),
    postedCents: sum(posted),
    forecastCents: sum(forecast),
    remainingCents: cents(
      all.filter(isInstallment).reduce<number>((a, c) => a + (c.remainingCents ?? 0), 0)
    ),
    next: forecast[0] ?? null,
    timeline: buildTimeline(all, ctx.today),
  };
}
