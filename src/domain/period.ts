/**
 * Tempo. A unica fonte de "hoje" do sistema.
 *
 * `new Date()` e' proibido fora deste arquivo. A Vercel roda em UTC e
 * `new Date()` as 21h30 de Brasilia no dia 31 devolve o dia 1 do mes seguinte —
 * o que jogaria lancamentos, faturas e vencimentos no mes errado.
 *
 * A aritmetica de calendario aqui e' feita com inteiros (ano, mes, dia), nao com
 * `Date`, justamente para nao haver fuso envolvido. `Date` so aparece em
 * `todayInTimeZone` e na formatacao de nomes de mes.
 */

declare const plainDateBrand: unique symbol;
declare const refMonthBrand: unique symbol;

/** Data civil sem hora nem fuso, no formato `AAAA-MM-DD`. */
export type PlainDate = string & { readonly [plainDateBrand]: true };
/** Mes de referencia no formato `AAAA-MM`. Chave temporal universal do sistema. */
export type RefMonth = string & { readonly [refMonthBrand]: true };

export class PeriodError extends Error {}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

/** dom..sab — a ordem que o calendario 6x7 do design usa. */
export const WEEKDAYS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"] as const;
export const MONTHS_SHORT = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
] as const;

// ── construtores ─────────────────────────────────────────────────────────────

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonthOf(year: number, month: number): number {
  if (month < 1 || month > 12) throw new PeriodError(`Mes invalido: ${month}`);
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function plainDate(value: string): PlainDate {
  const m = DATE_RE.exec(value);
  if (!m) throw new PeriodError(`Data invalida: ${value}`);
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12) throw new PeriodError(`Mes invalido em: ${value}`);
  if (day < 1 || day > daysInMonthOf(year, month)) {
    throw new PeriodError(`Dia invalido em: ${value}`);
  }
  return value as PlainDate;
}

export function refMonth(value: string): RefMonth {
  const m = MONTH_RE.exec(value);
  if (!m) throw new PeriodError(`Mes de referencia invalido: ${value}`);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new PeriodError(`Mes invalido em: ${value}`);
  return value as RefMonth;
}

/** Aceita entrada do usuario (segmento de rota). Devolve `null` em vez de lancar. */
export function parseMonthParam(value: string | undefined | null): RefMonth | null {
  if (!value) return null;
  try {
    return refMonth(value);
  } catch {
    return null;
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function makeDate(year: number, month: number, day: number): PlainDate {
  return plainDate(`${String(year).padStart(4, "0")}-${pad2(month)}-${pad2(day)}`);
}

export function makeMonth(year: number, month: number): RefMonth {
  return refMonth(`${String(year).padStart(4, "0")}-${pad2(month)}`);
}

// ── decomposicao ─────────────────────────────────────────────────────────────

export function partsOfDate(date: PlainDate): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(date);
  if (!m) throw new PeriodError(`Data invalida: ${date}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function partsOfMonth(month: RefMonth): { year: number; month: number } {
  const m = MONTH_RE.exec(month);
  if (!m) throw new PeriodError(`Mes invalido: ${month}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function monthOf(date: PlainDate): RefMonth {
  const { year, month } = partsOfDate(date);
  return makeMonth(year, month);
}

export function daysInMonth(month: RefMonth): number {
  const p = partsOfMonth(month);
  return daysInMonthOf(p.year, p.month);
}

/** Primeiro dia do mes, como data. */
export function firstDayOf(month: RefMonth): PlainDate {
  const p = partsOfMonth(month);
  return makeDate(p.year, p.month, 1);
}

export function lastDayOf(month: RefMonth): PlainDate {
  const p = partsOfMonth(month);
  return makeDate(p.year, p.month, daysInMonthOf(p.year, p.month));
}

// ── aritmetica ───────────────────────────────────────────────────────────────

export function addMonths(month: RefMonth, delta: number): RefMonth {
  const p = partsOfMonth(month);
  const zeroBased = p.year * 12 + (p.month - 1) + delta;
  return makeMonth(Math.floor(zeroBased / 12), (((zeroBased % 12) + 12) % 12) + 1);
}

/** Positivo se `b` e' posterior a `a`. */
export function monthsBetween(a: RefMonth, b: RefMonth): number {
  const pa = partsOfMonth(a);
  const pb = partsOfMonth(b);
  return (pb.year - pa.year) * 12 + (pb.month - pa.month);
}

/**
 * Encaixa um "dia do mes" num mes concreto.
 *
 * Uma conta que vence dia 31 precisa cair em 28/02 (ou 29). O design nao trata
 * isso — todos os `dia` do mock cabem em agosto, que tem 31 dias.
 */
export function clampDay(month: RefMonth, day: number): PlainDate {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new PeriodError(`Dia do mes invalido: ${day}`);
  }
  const p = partsOfMonth(month);
  return makeDate(p.year, p.month, Math.min(day, daysInMonthOf(p.year, p.month)));
}

/** Dias corridos desde 1970-01-01, para diferenca entre datas sem usar `Date`. */
function toEpochDay(date: PlainDate): number {
  const { year, month, day } = partsOfDate(date);
  // Algoritmo civil-from-days de Howard Hinnant, sem fuso envolvido.
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

function fromEpochDay(epochDay: number): PlainDate {
  const z = epochDay + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365
  );
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return makeDate(m <= 2 ? y + 1 : y, m, d);
}

export function addDays(date: PlainDate, delta: number): PlainDate {
  return fromEpochDay(toEpochDay(date) + delta);
}

/** Positivo se `b` e' posterior a `a`. */
export function daysBetween(a: PlainDate, b: PlainDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

export function compareDates(a: PlainDate, b: PlainDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isBefore(a: PlainDate, b: PlainDate): boolean {
  return a < b;
}

export function isAfter(a: PlainDate, b: PlainDate): boolean {
  return a > b;
}

export function isSameOrBefore(a: PlainDate, b: PlainDate): boolean {
  return a <= b;
}

/**
 * Dia da semana: 0 = domingo. Calculado, nao derivado de `Date`.
 *
 * O calendario do design usa offset fixo (`i - 5 + 1`), que so funciona para
 * agosto de 2026. Esta funcao e' o que substitui aquilo.
 */
export function weekdayOf(date: PlainDate): number {
  return ((toEpochDay(date) % 7) + 11) % 7;
}

/** Em que coluna (0=dom) cai o dia 1 do mes. Base da grade 6x7. */
export function firstWeekdayOf(month: RefMonth): number {
  return weekdayOf(firstDayOf(month));
}

// ── "hoje" ───────────────────────────────────────────────────────────────────

const isoInTz = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = isoInTz.get(timeZone);
  if (!f) {
    // en-CA formata como AAAA-MM-DD, que e' exatamente o PlainDate.
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    isoInTz.set(timeZone, f);
  }
  return f;
}

/**
 * A data civil de agora no fuso informado.
 *
 * Unico ponto do sistema que le' o relogio, e le' sempre o relogio de verdade.
 * Ja' houve aqui um parametro para congelar "hoje" numa data fixa, vindo de
 * variavel de ambiente: servia para comparar a tela com o design. O design nao
 * manda mais nos numeros, e uma data injetavel por ambiente e' um jeito de o app
 * inteiro operar no dia errado sem ninguem notar.
 *
 * Quem precisa de tempo deterministico injeta a data por parametro — todo
 * servico recebe `today` do `AppContext`, ninguem le' o relogio la' dentro.
 */
export function todayInTimeZone(timeZone: string = DEFAULT_TIME_ZONE): PlainDate {
  return plainDate(formatterFor(timeZone).format(new Date()));
}

/**
 * A data civil de um instante no fuso informado.
 *
 * `created_at` e' um instante absoluto (timestamptz). Um lancamento feito as
 * 22h de Brasilia ja' e' o dia seguinte em UTC — sem passar por aqui, o painel
 * diria "ontem" para algo lancado ha' uma hora.
 */
export function dateInTimeZone(at: Date, timeZone: string = DEFAULT_TIME_ZONE): PlainDate {
  return plainDate(formatterFor(timeZone).format(at));
}

/**
 * O instante de agora, sem fuso envolvido.
 *
 * Existe para prazo de sessao e carimbo de tentativa de login — coisas medidas
 * em tempo absoluto, nao em data civil. Fica aqui junto com `todayInTimeZone`
 * para que `new Date()` continue existindo num arquivo so' do projeto: e' o que
 * torna "o app usa o relogio errado" uma busca de um grep.
 */
export function nowInstant(): Date {
  return new Date();
}

// ── rotulos ──────────────────────────────────────────────────────────────────

const monthNameFmt = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });

/**
 * "Agosto 2026".
 *
 * Capitalizacao feita em JS de proposito: `text-transform: capitalize` no CSS
 * produziria "Agosto De 2026" em qualquer formato que inclua a preposicao.
 */
export function monthLabel(month: RefMonth): string {
  const p = partsOfMonth(month);
  const name = monthNameFmt.format(Date.UTC(2000, p.month - 1, 1));
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${p.year}`;
}

/** "01/08" — formato curto usado na tabela de lancamentos. */
export function shortDate(date: PlainDate): string {
  const { month, day } = partsOfDate(date);
  return `${pad2(day)}/${pad2(month)}`;
}

const stampInTz = new Map<string, Intl.DateTimeFormat>();

/**
 * "11/08 14:32" — instante formatado no relogio do usuario.
 *
 * Sem o `timeZone` explicito, `toLocaleString` usa o fuso do processo: a Vercel
 * roda em UTC e o painel mostraria toda hora 3h adiantada.
 */
export function shortDateTime(at: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  let f = stampInTz.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("pt-BR", {
      timeZone,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    stampInTz.set(timeZone, f);
  }
  return f.format(at);
}

/** "01/08/2026" */
export function fullDate(date: PlainDate): string {
  const { year, month, day } = partsOfDate(date);
  return `${pad2(day)}/${pad2(month)}/${year}`;
}

/** "ago" — rotulo do grafico de fluxo. */
export function monthShortLabel(month: RefMonth): string {
  const p = partsOfMonth(month);
  return MONTHS_SHORT[p.month - 1] ?? "";
}
