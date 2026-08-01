import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  clampDay,
  compareDates,
  daysBetween,
  daysInMonth,
  firstDayOf,
  firstWeekdayOf,
  fullDate,
  isAfter,
  isBefore,
  isSameOrBefore,
  lastDayOf,
  makeMonth,
  monthLabel,
  monthOf,
  monthShortLabel,
  monthsBetween,
  PeriodError,
  parseMonthParam,
  plainDate,
  refMonth,
  shortDate,
  todayInTimeZone,
  WEEKDAYS,
  weekdayOf,
} from "./period";

const d = plainDate;
const m = refMonth;

describe("validacao", () => {
  it("recusa data inexistente", () => {
    expect(() => d("2026-02-30")).toThrow(PeriodError);
    expect(() => d("2026-13-01")).toThrow(PeriodError);
    expect(() => d("2026-8-1")).toThrow(PeriodError);
  });

  it("aceita 29 de fevereiro em ano bissexto e recusa fora dele", () => {
    expect(d("2028-02-29")).toBe("2028-02-29");
    expect(() => d("2026-02-29")).toThrow(PeriodError);
  });

  it("parseMonthParam devolve null em vez de lancar", () => {
    expect(parseMonthParam("2026-08")).toBe("2026-08");
    expect(parseMonthParam("lixo")).toBeNull();
    expect(parseMonthParam(undefined)).toBeNull();
    expect(parseMonthParam("2026-13")).toBeNull();
  });
});

describe("dias no mes", () => {
  it("conhece os meses de 30, 31 e 28/29", () => {
    expect(daysInMonth(m("2026-08"))).toBe(31);
    expect(daysInMonth(m("2026-04"))).toBe(30);
    expect(daysInMonth(m("2026-02"))).toBe(28);
    expect(daysInMonth(m("2028-02"))).toBe(29);
    expect(daysInMonth(m("2100-02"))).toBe(28); // divisivel por 100, nao por 400
    expect(daysInMonth(m("2000-02"))).toBe(29); // divisivel por 400
  });
});

describe("clampDay", () => {
  it("encaixa dia 31 em mes curto", () => {
    expect(clampDay(m("2026-02"), 31)).toBe("2026-02-28");
    expect(clampDay(m("2028-02"), 31)).toBe("2028-02-29");
    expect(clampDay(m("2026-04"), 31)).toBe("2026-04-30");
  });

  it("mantem o dia quando cabe", () => {
    expect(clampDay(m("2026-08"), 31)).toBe("2026-08-31");
    expect(clampDay(m("2026-08"), 5)).toBe("2026-08-05");
  });

  it("recusa dia fora de 1..31", () => {
    expect(() => clampDay(m("2026-08"), 0)).toThrow(PeriodError);
    expect(() => clampDay(m("2026-08"), 32)).toThrow(PeriodError);
  });
});

describe("aritmetica de mes", () => {
  it("avanca e retrocede atravessando o ano", () => {
    expect(addMonths(m("2026-08"), 1)).toBe("2026-09");
    expect(addMonths(m("2026-12"), 1)).toBe("2027-01");
    expect(addMonths(m("2026-01"), -1)).toBe("2025-12");
    expect(addMonths(m("2026-08"), 12)).toBe("2027-08");
    expect(addMonths(m("2026-08"), -20)).toBe("2024-12");
  });

  it("monthsBetween e' o inverso de addMonths", () => {
    for (const delta of [-24, -13, -1, 0, 1, 7, 18]) {
      const base = m("2026-08");
      expect(monthsBetween(base, addMonths(base, delta))).toBe(delta);
    }
  });
});

describe("aritmetica de data", () => {
  it("atravessa fim de mes e de ano", () => {
    expect(addDays(d("2026-08-31"), 1)).toBe("2026-09-01");
    expect(addDays(d("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(d("2026-03-01"), -1)).toBe("2026-02-28");
    expect(addDays(d("2028-03-01"), -1)).toBe("2028-02-29");
  });

  it("daysBetween conta corretamente", () => {
    expect(daysBetween(d("2026-08-01"), d("2026-08-08"))).toBe(7);
    expect(daysBetween(d("2026-08-08"), d("2026-08-01"))).toBe(-7);
    expect(daysBetween(d("2026-02-28"), d("2026-03-01"))).toBe(1);
    expect(daysBetween(d("2028-02-28"), d("2028-03-01"))).toBe(2);
  });
});

describe("dia da semana", () => {
  it("acerta datas conhecidas", () => {
    expect(weekdayOf(d("2026-08-01"))).toBe(6); // sabado
    expect(weekdayOf(d("2026-08-02"))).toBe(0); // domingo
    expect(weekdayOf(d("2000-01-01"))).toBe(6); // sabado
    expect(weekdayOf(d("1970-01-01"))).toBe(4); // quinta
    expect(weekdayOf(d("2024-02-29"))).toBe(4); // quinta
  });

  it("firstWeekdayOf da' a coluna inicial da grade 6x7", () => {
    // O design cravou offset fixo (i - 5 + 1), que so vale para agosto/2026:
    // dia 1 caindo no sabado, coluna 6.
    expect(firstWeekdayOf(m("2026-08"))).toBe(6);
    expect(firstWeekdayOf(m("2026-09"))).toBe(2); // terca
    expect(firstWeekdayOf(m("2026-02"))).toBe(0); // domingo
  });

  it("confere com o Date nativo em UTC para um ano inteiro", () => {
    for (let i = 0; i < 366; i++) {
      const date = addDays(d("2026-01-01"), i);
      const native = new Date(`${date}T00:00:00Z`).getUTCDay();
      expect(weekdayOf(date)).toBe(native);
    }
  });
});

describe("hoje", () => {
  it("respeita a data congelada", () => {
    expect(todayInTimeZone("America/Sao_Paulo", "2026-08-01")).toBe("2026-08-01");
  });

  it("devolve a data civil de Sao Paulo, nao a de UTC", () => {
    // Sem fake, so' da' para afirmar o formato e a consistencia entre fusos.
    const sp = todayInTimeZone("America/Sao_Paulo");
    const utc = todayInTimeZone("UTC");
    expect(sp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Sao Paulo esta' atras de UTC, entao nunca pode estar a' frente.
    expect(sp <= utc).toBe(true);
    expect(daysBetween(sp, utc)).toBeLessThanOrEqual(1);
  });
});

describe("rotulos", () => {
  it("monthLabel capitaliza sem a preposicao", () => {
    // `text-transform: capitalize` produziria "Agosto De 2026".
    expect(monthLabel(m("2026-08"))).toBe("Agosto 2026");
    expect(monthLabel(m("2026-01"))).toBe("Janeiro 2026");
    expect(monthLabel(m("2026-03"))).toBe("Março 2026");
  });

  it("monthShortLabel bate com o grafico de fluxo do design", () => {
    expect(monthShortLabel(m("2026-03"))).toBe("mar");
    expect(monthShortLabel(m("2026-08"))).toBe("ago");
  });

  it("shortDate como na tabela de lancamentos", () => {
    expect(shortDate(d("2026-08-01"))).toBe("01/08");
    expect(shortDate(d("2026-07-31"))).toBe("31/07");
  });

  it("monthOf e makeMonth sao consistentes", () => {
    expect(monthOf(d("2026-08-15"))).toBe("2026-08");
    expect(makeMonth(2026, 8)).toBe("2026-08");
  });

  it("fullDate para o campo de data do modal", () => {
    expect(fullDate(d("2026-08-01"))).toBe("01/08/2026");
  });

  it("WEEKDAYS na ordem do cabecalho do calendario", () => {
    expect(WEEKDAYS).toEqual(["dom", "seg", "ter", "qua", "qui", "sex", "sáb"]);
  });
});

describe("limites e comparacao de periodo", () => {
  it("firstDayOf e lastDayOf delimitam o mes", () => {
    expect(firstDayOf(m("2026-08"))).toBe("2026-08-01");
    expect(lastDayOf(m("2026-08"))).toBe("2026-08-31");
    expect(lastDayOf(m("2026-02"))).toBe("2026-02-28");
    expect(lastDayOf(m("2028-02"))).toBe("2028-02-29");
  });

  it("compara datas", () => {
    expect(compareDates(d("2026-08-01"), d("2026-08-02"))).toBe(-1);
    expect(compareDates(d("2026-08-02"), d("2026-08-01"))).toBe(1);
    expect(compareDates(d("2026-08-01"), d("2026-08-01"))).toBe(0);
  });

  it("isBefore / isAfter / isSameOrBefore", () => {
    const hoje = d("2026-08-01");
    expect(isBefore(d("2026-07-31"), hoje)).toBe(true);
    expect(isAfter(d("2026-08-02"), hoje)).toBe(true);
    // A regra C4 do plano: due_date <= hoje entra na fatura.
    expect(isSameOrBefore(hoje, hoje)).toBe(true);
    expect(isSameOrBefore(d("2026-08-02"), hoje)).toBe(false);
  });
});
