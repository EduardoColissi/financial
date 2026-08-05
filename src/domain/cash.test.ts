import { describe, expect, it } from "vitest";
import { closeMonth, emergencyTarget, essentialAverage, type MonthFlow, runMonths } from "./cash";
import { cents } from "./money";

const c = (n: number) => cents(n);

const fluxo = (p: Partial<Record<keyof MonthFlow, number>> = {}): MonthFlow => ({
  incomeCents: c(p.incomeCents ?? 0),
  paidOutCents: c(p.paidOutCents ?? 0),
  pendingCents: c(p.pendingCents ?? 0),
  contributedCents: c(p.contributedCents ?? 0),
});

describe("closeMonth", () => {
  it("mes que abre do zero: caixa e' o que entrou menos o que saiu", () => {
    const m = closeMonth(c(0), fluxo({ incomeCents: 1240000, paidOutCents: 400000 }));
    expect(m.cashCents).toBe(840000);
    expect(m.leftoverCents).toBe(840000);
    expect(m.settled).toBe(true);
  });

  it("o pendente separa em conta de sobra", () => {
    const m = closeMonth(
      c(0),
      fluxo({ incomeCents: 1240000, paidOutCents: 400000, pendingCents: 600000 })
    );
    expect(m.cashCents).toBe(840000);
    expect(m.leftoverCents).toBe(240000);
    expect(m.settled).toBe(false);
  });

  it("a sobra do mes anterior entra como dinheiro disponivel", () => {
    const m = closeMonth(c(50000), fluxo({ incomeCents: 1000000, paidOutCents: 300000 }));
    expect(m.carriedCents).toBe(50000);
    expect(m.cashCents).toBe(750000);
  });

  /** Divida e' informacao, nao erro: gastar mais do que entrou tem que aparecer. */
  it("aceita fechar no vermelho", () => {
    const m = closeMonth(c(0), fluxo({ incomeCents: 100000, paidOutCents: 300000 }));
    expect(m.cashCents).toBe(-200000);
    expect(m.leftoverCents).toBe(-200000);
  });

  it("o que passa para o proximo mes e' a SOBRA, nao o caixa", () => {
    // Ainda ha' 600 a pagar: essa folga nao pode viajar como se fosse livre.
    const m = closeMonth(
      c(0),
      fluxo({ incomeCents: 1000000, paidOutCents: 0, pendingCents: 600000 })
    );
    expect(m.cashCents).toBe(1000000);
    expect(m.carryToNextCents).toBe(400000);
  });
});

/**
 * A corrente de meses — o coracao do modelo de envelope.
 *
 * O que atravessa o mes NAO e' saldo bancario parado: e' o que sobrou e nao foi
 * investido. Se estes testes falharem, o painel voltou a somar dinheiro que ja'
 * foi gasto.
 */
describe("runMonths", () => {
  it("mes totalmente aportado abre o seguinte em zero", () => {
    // Agosto sobra 2.000 e aporta os 2.000 — o aporte SAI do caixa, entao ele
    // ja' esta' em `paidOutCents`.
    const [agosto, setembro] = runMonths([
      fluxo({ incomeCents: 1240000, paidOutCents: 1040000 + 200000, contributedCents: 200000 }),
      fluxo({ incomeCents: 1000000, paidOutCents: 1000000 }),
    ]);
    expect(agosto?.leftoverCents).toBe(0);
    expect(agosto?.carryToNextCents).toBe(0);
    expect(setembro?.carriedCents).toBe(0);
    expect(setembro?.cashCents).toBe(0);
  });

  it("aporte parcial: so' o resto viaja", () => {
    // Sobrou 2.000, aportou 1.500 (ja' descontado do caixa). Restam 500.
    const [agosto, setembro] = runMonths([
      fluxo({ incomeCents: 1240000, paidOutCents: 1040000 + 150000, contributedCents: 150000 }),
      fluxo({ incomeCents: 0, paidOutCents: 0 }),
    ]);
    expect(agosto?.leftoverCents).toBe(50000);
    expect(setembro?.carriedCents).toBe(50000);
    expect(setembro?.cashCents).toBe(50000);
  });

  it("sem aporte nenhum, a sobra inteira atravessa", () => {
    const [, setembro] = runMonths([
      fluxo({ incomeCents: 1000000, paidOutCents: 800000 }),
      fluxo(),
    ]);
    expect(setembro?.carriedCents).toBe(200000);
  });

  it("divida tambem atravessa — comecar o mes devendo e' o fato", () => {
    const [, setembro] = runMonths([
      fluxo({ incomeCents: 100000, paidOutCents: 400000 }),
      fluxo({ incomeCents: 500000 }),
    ]);
    expect(setembro?.carriedCents).toBe(-300000);
    expect(setembro?.cashCents).toBe(200000);
  });

  it("acumula ao longo de varios meses", () => {
    const meses = runMonths([
      fluxo({ incomeCents: 300000, paidOutCents: 200000 }),
      fluxo({ incomeCents: 300000, paidOutCents: 200000 }),
      fluxo({ incomeCents: 300000, paidOutCents: 200000 }),
    ]);
    expect(meses[0]?.carryToNextCents).toBe(100000);
    expect(meses[1]?.cashCents).toBe(200000);
    expect(meses[2]?.cashCents).toBe(300000);
  });

  it("primeiro mes sempre abre em zero", () => {
    const [primeiro] = runMonths([fluxo({ incomeCents: 500000 })]);
    expect(primeiro?.carriedCents).toBe(0);
  });

  it("lista vazia nao quebra", () => {
    expect(runMonths([])).toEqual([]);
  });

  /**
   * A invariante do painel: pagar derruba "em conta" e nao mexe na "sobra",
   * porque o compromisso ja' estava contado.
   */
  it("pagar move o caixa e deixa a sobra parada", () => {
    const antes = closeMonth(c(0), fluxo({ incomeCents: 800000, pendingCents: 752200 }));
    const depois = closeMonth(c(0), fluxo({ incomeCents: 800000, paidOutCents: 752200 }));
    expect(antes.cashCents).toBe(800000);
    expect(depois.cashCents).toBe(47800);
    expect(antes.leftoverCents).toBe(depois.leftoverCents);
    expect(depois.settled).toBe(true);
  });
});

describe("essentialAverage e a meta de emergencia", () => {
  it("no primeiro mes a media e' o proprio mes", () => {
    expect(essentialAverage([c(500000)])).toBe(500000);
  });

  it("no segundo mes vira a media dos dois", () => {
    expect(essentialAverage([c(500000), c(700000)])).toBe(600000);
  });

  /**
   * Mes ainda sem conta obrigatoria lancada nao pode puxar a media para baixo —
   * seria dizer que naquele mes se viveu de graca, e a reserva nasceria curta.
   */
  it("ignora meses zerados", () => {
    expect(essentialAverage([c(0), c(600000), c(0)])).toBe(600000);
  });

  it("devolve zero quando nao ha' dado nenhum", () => {
    expect(essentialAverage([])).toBe(0);
    expect(essentialAverage([c(0), c(0)])).toBe(0);
  });

  it("arredonda para centavo inteiro", () => {
    expect(essentialAverage([c(100), c(101)])).toBe(101);
  });

  it("a meta e' seis meses do custo medio", () => {
    expect(emergencyTarget(c(600000))).toBe(3600000);
    expect(emergencyTarget(c(0))).toBe(0);
  });
});
