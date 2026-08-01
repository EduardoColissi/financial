import { describe, expect, it } from "vitest";
import { cents, sumCents } from "./money";
import {
  allowsInstallments,
  type EntryInput,
  effectHint,
  methodsFor,
  planEntry,
  previewOf,
  scheduleLabel,
} from "./new-entry";
import { plainDate, refMonth } from "./period";

const base: EntryInput = {
  type: "despesa",
  amountCents: cents(10000),
  method: "pix",
  onCredit: false,
  occurredOn: plainDate("2026-08-14"),
  installments: 1,
  repeats: false,
};

const labels = {
  categoryName: "Alimentação",
  methodLabel: "Pix",
  targetName: "Nubank · Conta",
};

describe("forma do lancamento", () => {
  it("a' vista vira uma transacao", () => {
    const plan = planEntry(base);
    expect(plan.shape).toBe("transaction");
    expect(plan.schedule).toHaveLength(1);
  });

  it("parcelado vira regra, nao N transacoes soltas", () => {
    const plan = planEntry({ ...base, method: "credit", onCredit: true, installments: 10 });
    expect(plan.shape).toBe("installment-rule");
    expect(plan.schedule).toHaveLength(10);
  });

  it("toggle de repeticao vira regra sem fim previsto", () => {
    const plan = planEntry({ ...base, repeats: true });
    expect(plan.shape).toBe("recurring-rule");
    expect(plan.lastRefMonth).toBeNull();
  });

  it("parcelamento manda sobre o toggle — uma obrigacao, uma regra", () => {
    const plan = planEntry({
      ...base,
      method: "credit",
      onCredit: true,
      installments: 3,
      repeats: true,
    });
    expect(plan.shape).toBe("installment-rule");
  });
});

describe("dinheiro", () => {
  it("a soma das parcelas fecha exatamente o total", () => {
    for (const total of [10000, 9999, 100, 3, 259990]) {
      for (const n of [2, 3, 4, 7, 12]) {
        const plan = planEntry({
          ...base,
          amountCents: cents(total),
          method: "credit",
          onCredit: true,
          installments: n,
        });
        expect(sumCents(plan.schedule)).toBe(total);
      }
    }
  });

  it("o resto vai para a primeira parcela", () => {
    const plan = planEntry({
      ...base,
      amountCents: cents(10000),
      method: "credit",
      onCredit: true,
      installments: 3,
    });
    expect(plan.schedule).toEqual([3334, 3333, 3333]);
  });
});

describe("efeito no caixa", () => {
  it("compra no credito nao tira do caixa hoje, mas conta como despesa", () => {
    const plan = planEntry({ ...base, method: "credit", onCredit: true });
    expect(plan.effect.affectsCash).toBe(false);
    expect(plan.effect.countsAsExpense).toBe(true);
    expect(plan.settlesOnPurchase).toBe(false);
    expect(plan.status).toBe("na fatura");
  });

  it("aporte sai do caixa e nao e' despesa", () => {
    const plan = planEntry({ ...base, type: "aporte", method: "transfer" });
    expect(plan.effect.affectsCash).toBe(true);
    expect(plan.effect.countsAsExpense).toBe(false);
    expect(plan.effect.countsAsContribution).toBe(true);
  });

  it("competencia e' o mes da COMPRA, nao o do vencimento da fatura", () => {
    const plan = planEntry({
      ...base,
      method: "credit",
      onCredit: true,
      occurredOn: plainDate("2026-08-29"),
    });
    expect(plan.competenceMonth).toBe(refMonth("2026-08"));
  });

  it("a ultima parcela cai N-1 meses depois da primeira", () => {
    const plan = planEntry({ ...base, method: "credit", onCredit: true, installments: 10 });
    expect(plan.firstRefMonth).toBe(refMonth("2026-08"));
    expect(plan.lastRefMonth).toBe(refMonth("2027-05"));
  });
});

describe("meios validos", () => {
  it("credito nao e' oferecido para receita nem aporte", () => {
    expect(methodsFor("receita")).not.toContain("credit");
    expect(methodsFor("aporte")).not.toContain("credit");
    expect(methodsFor("despesa")).toContain("credit");
  });

  it("parcela em boleto e' permitida — o design tem uma", () => {
    expect(allowsInstallments("despesa", "boleto")).toBe(true);
    expect(allowsInstallments("despesa", "credit")).toBe(true);
    expect(allowsInstallments("despesa", "pix")).toBe(false);
    expect(allowsInstallments("receita", "credit")).toBe(false);
  });
});

describe("previa", () => {
  it("diz o valor real de cada parcela quando ha' resto", () => {
    const plan = planEntry({
      ...base,
      amountCents: cents(10000),
      method: "credit",
      onCredit: true,
      installments: 3,
    });
    expect(scheduleLabel(plan.schedule)).toBe("3× de R$ 33,33 (1ª de R$ 33,34) = R$ 100,00");
  });

  it("omite o detalhe quando as parcelas sao iguais", () => {
    const plan = planEntry({
      ...base,
      amountCents: cents(9000),
      method: "credit",
      onCredit: true,
      installments: 3,
    });
    expect(scheduleLabel(plan.schedule)).toBe("3× de R$ 30,00 = R$ 90,00");
  });

  it("a' vista mostra so' o valor", () => {
    expect(scheduleLabel(planEntry(base).schedule)).toBe("R$ 100,00");
  });

  it("monta a linha completa", () => {
    expect(previewOf(planEntry(base), labels)).toBe(
      "R$ 100,00 · Alimentação · Pix · Nubank · Conta"
    );
  });

  it("avisa que a compra no credito nao sai do caixa hoje", () => {
    const plan = planEntry({ ...base, method: "credit", onCredit: true });
    expect(effectHint(plan, labels)).toContain("só sai quando a fatura for paga");
  });
});
