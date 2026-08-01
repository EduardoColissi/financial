import { describe, expect, it } from "vitest";
import { cashDelta, cashEffect, type MonthEntry, monthTotals } from "./cash-flow";
import { cents } from "./money";

describe("a matriz de efeito no caixa", () => {
  it("receita entra", () => {
    const e = cashEffect({ kind: "income", onCredit: false });
    expect(e).toMatchObject({ affectsCash: true, sign: 1, countsAsIncome: true });
  });

  it("despesa em conta sai do caixa e conta como despesa", () => {
    const e = cashEffect({ kind: "expense", onCredit: false });
    expect(e).toMatchObject({ affectsCash: true, sign: -1, countsAsExpense: true });
  });

  it("despesa no credito NAO sai do caixa, mas CONTA como despesa do mes", () => {
    // Decisao do usuario: competencia pelo mes da compra.
    const e = cashEffect({ kind: "expense", onCredit: true });
    expect(e.affectsCash).toBe(false);
    expect(e.sign).toBe(0);
    expect(e.countsAsExpense).toBe(true);
  });

  it("aporte sai do caixa e nao e' despesa", () => {
    const e = cashEffect({ kind: "investment_out", onCredit: false });
    expect(e).toMatchObject({
      affectsCash: true,
      sign: -1,
      countsAsExpense: false,
      countsAsContribution: true,
    });
  });

  it("resgate entra no caixa e nao e' receita do mes", () => {
    const e = cashEffect({ kind: "investment_in", onCredit: false });
    expect(e).toMatchObject({ affectsCash: true, sign: 1, countsAsIncome: false });
  });

  it("pagamento de fatura sai do caixa e nao e' despesa", () => {
    // Se fosse despesa, o gasto seria contado duas vezes: na compra e no pagamento.
    const e = cashEffect({ kind: "transfer", onCredit: false, transferTarget: "statement" });
    expect(e).toMatchObject({ affectsCash: true, sign: -1, countsAsExpense: false });
  });

  it("transferencia entre contas proprias e' neutra no total", () => {
    const e = cashEffect({ kind: "transfer", onCredit: false, transferTarget: "account" });
    expect(e).toMatchObject({ affectsCash: false, sign: 0, countsAsExpense: false });
  });

  it("estorno de despesa devolve dinheiro ao caixa", () => {
    const e = cashEffect({ kind: "expense", onCredit: false, isRefund: true });
    expect(e.sign).toBe(1);
  });
});

describe("cashDelta", () => {
  it("aplica o sinal ao valor", () => {
    expect(cashDelta({ kind: "income", onCredit: false }, cents(980000))).toBe(980000);
    expect(cashDelta({ kind: "expense", onCredit: false }, cents(220000))).toBe(-220000);
  });

  it("compra no credito nao move o caixa", () => {
    expect(cashDelta({ kind: "expense", onCredit: true }, cents(41280))).toBe(0);
  });
});

describe("totais do mes", () => {
  it("reproduz os KPIs de agosto do design", () => {
    // Receitas 12.400, despesas 7.389,45, aporte 2.600 (linhas 1156-1158).
    const entradas: MonthEntry[] = [
      { kind: "income", onCredit: false, amountCents: cents(980000) },
      { kind: "income", onCredit: false, amountCents: cents(260000) },
      { kind: "investment_out", onCredit: false, amountCents: cents(260000) },
      { kind: "expense", onCredit: false, amountCents: cents(220000) },
      { kind: "expense", onCredit: true, amountCents: cents(518945) },
    ];

    const t = monthTotals(entradas);
    expect(t.incomeCents).toBe(1240000);
    expect(t.expenseCents).toBe(738945);
    expect(t.contributionCents).toBe(260000);
    // livre = receitas − despesas − aporte
    expect(t.freeCents).toBe(1240000 - 738945 - 260000);
  });

  it("pagamento de fatura nao aparece em nenhum total", () => {
    const semPagamento = monthTotals([
      { kind: "expense", onCredit: true, amountCents: cents(100000) },
    ]);
    const comPagamento = monthTotals([
      { kind: "expense", onCredit: true, amountCents: cents(100000) },
      {
        kind: "transfer",
        onCredit: false,
        transferTarget: "statement",
        amountCents: cents(100000),
      },
    ]);
    expect(comPagamento).toEqual(semPagamento);
  });

  it("estorno reduz a despesa em vez de virar receita", () => {
    const t = monthTotals([
      { kind: "expense", onCredit: false, amountCents: cents(50000) },
      { kind: "expense", onCredit: false, amountCents: cents(20000), isRefund: true },
    ]);
    expect(t.expenseCents).toBe(30000);
    expect(t.incomeCents).toBe(0);
  });

  it("mes vazio nao produz NaN", () => {
    const t = monthTotals([]);
    expect(t).toEqual({
      incomeCents: 0,
      expenseCents: 0,
      contributionCents: 0,
      freeCents: 0,
    });
  });
});
