import { describe, expect, it } from "vitest";
import {
  installmentLabel,
  installmentProgress,
  isActiveIn,
  lastRefMonthOf,
  remainingAfterCurrent,
  remainingIncludingCurrent,
  sequenceFor,
  totalRemaining,
} from "./installments";
import { cents } from "./money";
import { refMonth } from "./period";

const m = refMonth;

describe("sequencia derivada", () => {
  it("conta a partir do primeiro mes", () => {
    expect(sequenceFor(m("2026-04"), m("2026-04"))).toBe(1);
    expect(sequenceFor(m("2026-04"), m("2026-08"))).toBe(5);
  });

  it("nao depende de meses ja' gerados", () => {
    // E' isto que torna a materializacao idempotente: gerar novembro sem ter
    // gerado outubro produz o numero certo.
    expect(sequenceFor(m("2026-01"), m("2026-11"))).toBe(11);
  });

  it("atravessa o ano", () => {
    expect(sequenceFor(m("2026-11"), m("2027-02"))).toBe(4);
  });
});

describe("regra ativa no mes", () => {
  const parcelada = { firstRefMonth: m("2026-04"), installmentsTotal: 12 };

  it("ativa dentro do intervalo", () => {
    expect(isActiveIn(parcelada, m("2026-04"))).toBe(true);
    expect(isActiveIn(parcelada, m("2027-03"))).toBe(true);
  });

  it("inativa antes do inicio e depois do fim", () => {
    expect(isActiveIn(parcelada, m("2026-03"))).toBe(false);
    expect(isActiveIn(parcelada, m("2027-04"))).toBe(false);
  });

  it("assinatura sem fim segue ativa indefinidamente", () => {
    const assinatura = { firstRefMonth: m("2026-01") };
    expect(isActiveIn(assinatura, m("2030-12"))).toBe(true);
  });

  it("pausada e arquivada nao geram cobranca", () => {
    expect(isActiveIn({ ...parcelada, pausedAt: "2026-05-01" }, m("2026-06"))).toBe(false);
    expect(isActiveIn({ ...parcelada, archivedAt: "2026-05-01" }, m("2026-06"))).toBe(false);
  });

  it("respeita endRefMonth", () => {
    const comFim = { firstRefMonth: m("2026-01"), endRefMonth: m("2026-06") };
    expect(isActiveIn(comFim, m("2026-06"))).toBe(true);
    expect(isActiveIn(comFim, m("2026-07"))).toBe(false);
  });

  it("lastRefMonthOf conhece o fim das parceladas", () => {
    expect(lastRefMonthOf(parcelada)).toBe("2027-03");
    expect(lastRefMonthOf({ firstRefMonth: m("2026-01") })).toBeNull();
  });
});

describe("as DUAS formulas de 'quanto falta' — o design usa ambas", () => {
  // Notebook Dell: parcela 5 de 10, R$ 389,90 (linhas 1079 e 1094).
  const valor = cents(38990);

  it("aba Assinaturas inclui a parcela corrente", () => {
    // Design linha 1295: valor * (pt - pa + 1) = 389,90 * 6
    expect(remainingIncludingCurrent(valor, 5, 10)).toBe(38990 * 6);
  });

  it("aba Cartoes exclui a parcela corrente", () => {
    // Design linha 1317: p.v * (p.pt - p.p) = 389,90 * 5
    expect(remainingAfterCurrent(valor, 5, 10)).toBe(38990 * 5);
  });

  it("a diferenca entre elas e' exatamente uma parcela", () => {
    expect(remainingIncludingCurrent(valor, 5, 10) - remainingAfterCurrent(valor, 5, 10)).toBe(
      valor
    );
  });

  it("na ultima parcela: uma devolve o valor, a outra devolve zero", () => {
    expect(remainingIncludingCurrent(valor, 10, 10)).toBe(valor);
    expect(remainingAfterCurrent(valor, 10, 10)).toBe(0);
  });

  it("nunca devolve negativo se a sequencia passar do total", () => {
    expect(remainingIncludingCurrent(valor, 12, 10)).toBe(0);
    expect(remainingAfterCurrent(valor, 12, 10)).toBe(0);
  });
});

describe("progresso e rotulo", () => {
  it("progresso em porcentagem", () => {
    expect(installmentProgress(5, 10)).toBe(50);
    expect(installmentProgress(10, 10)).toBe(100);
  });

  it("nao explode com total zero", () => {
    expect(installmentProgress(1, 0)).toBe(0);
  });

  it("rotulo como no design", () => {
    expect(installmentLabel(5, 10)).toBe("5 de 10");
  });
});

describe("total em aberto", () => {
  it("soma os parcelamentos do Nubank do design", () => {
    // Notebook Dell 5/10 de 389,90 + Tenis 3/6 de 129,90
    const itens = [
      { amountCents: cents(38990), sequence: 5, total: 10 },
      { amountCents: cents(12990), sequence: 3, total: 6 },
    ];
    // Design (aba Cartoes, "a vencer"): 389,90*5 + 129,90*3
    expect(totalRemaining(itens, "after-current")).toBe(38990 * 5 + 12990 * 3);
    expect(totalRemaining(itens, "including-current")).toBe(38990 * 6 + 12990 * 4);
  });

  it("lista vazia soma zero", () => {
    expect(totalRemaining([])).toBe(0);
  });
});
