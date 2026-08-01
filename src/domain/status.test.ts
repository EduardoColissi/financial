import { describe, expect, it } from "vitest";
import { plainDate } from "./period";
import { chargePhase, chargePhaseTone, statusTone, txStatus } from "./status";

const d = plainDate;
const HOJE = d("2026-08-01");

describe("status derivado do lancamento", () => {
  it("credito vira 'na fatura', nunca 'pago'", () => {
    // No mock ha' compras no credito marcadas como pagas; o dinheiro nao saiu.
    expect(txStatus({ kind: "expense", onCredit: true })).toBe("na fatura");
  });

  it("credito parcelado vira 'parcelado'", () => {
    expect(txStatus({ kind: "expense", onCredit: true, installmentTotal: 10 })).toBe("parcelado");
  });

  it("parcela unica no credito continua 'na fatura'", () => {
    expect(txStatus({ kind: "expense", onCredit: true, installmentTotal: 1 })).toBe("na fatura");
  });

  it("sem liquidacao esta' em aberto", () => {
    expect(txStatus({ kind: "expense", onCredit: false })).toBe("em aberto");
    expect(txStatus({ kind: "expense", onCredit: false, settledOn: null })).toBe("em aberto");
  });

  it("liquidado muda o rotulo conforme o tipo", () => {
    expect(txStatus({ kind: "expense", onCredit: false, settledOn: HOJE })).toBe("pago");
    expect(txStatus({ kind: "income", onCredit: false, settledOn: HOJE })).toBe("recebido");
    expect(txStatus({ kind: "investment_out", onCredit: false, settledOn: HOJE })).toBe("aplicado");
    expect(txStatus({ kind: "investment_in", onCredit: false, settledOn: HOJE })).toBe("resgatado");
  });
});

describe("tom visual", () => {
  it("liquidado e' verde, em aberto e' ambar, fatura e' neutro", () => {
    expect(statusTone("pago")).toBe("ok");
    expect(statusTone("recebido")).toBe("ok");
    expect(statusTone("aplicado")).toBe("ok");
    expect(statusTone("em aberto")).toBe("warn");
    expect(statusTone("na fatura")).toBe("neutral");
    expect(statusTone("parcelado")).toBe("info");
  });
});

describe("fase da cobranca agendada (regra C4)", () => {
  it("no cartao: entra na fatura no dia do faturamento", () => {
    const noCartao = { onCredit: true, paid: false };
    expect(chargePhase({ ...noCartao, dueDate: d("2026-07-28") }, HOJE)).toBe("na fatura");
    expect(chargePhase({ ...noCartao, dueDate: HOJE }, HOJE)).toBe("na fatura");
    expect(chargePhase({ ...noCartao, dueDate: d("2026-08-14") }, HOJE)).toBe("prevista");
  });

  it("em conta ou boleto: vira vencida, nao 'na fatura'", () => {
    const emConta = { onCredit: false, paid: false };
    expect(chargePhase({ ...emConta, dueDate: d("2026-07-28") }, HOJE)).toBe("vencida");
    expect(chargePhase({ ...emConta, dueDate: d("2026-08-14") }, HOJE)).toBe("prevista");
  });

  it("paga vence qualquer outra fase", () => {
    expect(chargePhase({ onCredit: true, paid: true, dueDate: d("2026-07-01") }, HOJE)).toBe(
      "paga"
    );
  });

  it("a fronteira e' inclusiva: vencendo hoje ja' entrou", () => {
    // Design linha 1275: `r.dia <= HOJE`
    expect(chargePhase({ onCredit: true, paid: false, dueDate: HOJE }, HOJE)).toBe("na fatura");
  });

  it("tons das fases", () => {
    expect(chargePhaseTone("paga")).toBe("ok");
    expect(chargePhaseTone("vencida")).toBe("warn");
    expect(chargePhaseTone("prevista")).toBe("warn");
    expect(chargePhaseTone("na fatura")).toBe("neutral");
  });
});
