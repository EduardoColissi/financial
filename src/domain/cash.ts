import { type Cents, cents } from "./money";

/**
 * Envelope mensal — o mes comeca do zero e se fecha sozinho.
 *
 * NAO e' saldo bancario corrente. O dinheiro nao atravessa o mes por estar
 * parado numa conta; ele atravessa porque SOBROU e nao foi aportado. Se o mes
 * fecha com tudo pago e tudo investido, o mes seguinte abre em zero.
 *
 * A primeira versao deste modulo fazia saldo corrente — `abertura + entradas −
 * saidas`, acumulando desde sempre. Estava errado: a planilha do dono e' uma aba
 * por mes, com SOBRA/DIVIDA no fim de cada uma, e nada de saldo atravessando.
 *
 * Tudo aqui e' por COMPETENCIA, nao por data de pagamento. Pagar em setembro a
 * conta de agosto continua sendo despesa de agosto — do contrario o valor seria
 * subtraido duas vezes: uma na sobra de agosto, outra no caixa de setembro.
 */

/** O que aconteceu num mes. Tudo ja' filtrado por competencia pela consulta. */
export interface MonthFlow {
  /** Receitas efetivamente RECEBIDAS. Salario prometido nao e' dinheiro. */
  incomeCents: Cents;
  /** Saidas que ja' sairam do caixa: debito, pix, conta paga, fatura paga. */
  paidOutCents: Cents;
  /** O que ainda falta pagar: contas em aberto, faturas em aberto, avulsos nao liquidados. */
  pendingCents: Cents;
  /** Quanto foi aportado nos setores neste mes. */
  contributedCents: Cents;
}

export interface MonthCash {
  /** Sobra do mes anterior que nao virou investimento. */
  carriedCents: Cents;
  /** Dinheiro disponivel agora: o que veio, mais o que entrou, menos o que saiu. */
  cashCents: Cents;
  pendingCents: Cents;
  /** Saldo projetado do fim do mes. Negativo e' divida, e e' informacao. */
  leftoverCents: Cents;
  contributedCents: Cents;
  /** O que este mes entrega ao proximo: a sobra menos o que foi aportado. */
  carryToNextCents: Cents;
  /** Nada mais a pagar — os dois numeros do topo coincidem. */
  settled: boolean;
}

/**
 * Fecha um mes a partir do que veio do anterior.
 *
 * `carryToNext` sai da SOBRA, nao do dinheiro em conta: o que ainda falta pagar
 * neste mes nao pode viajar para o proximo como se fosse folga.
 */
export function closeMonth(carriedCents: Cents, flow: MonthFlow): MonthCash {
  const caixa = carriedCents + flow.incomeCents - flow.paidOutCents;
  const sobra = caixa - flow.pendingCents;

  return {
    carriedCents,
    cashCents: cents(caixa),
    pendingCents: flow.pendingCents,
    leftoverCents: cents(sobra),
    contributedCents: flow.contributedCents,
    // Aporte ja' saiu do caixa como lancamento, entao ele JA' esta' descontado
    // em `paidOutCents`. Subtrair de novo aqui tiraria o dinheiro duas vezes.
    carryToNextCents: cents(sobra),
    settled: flow.pendingCents === 0,
  };
}

/**
 * Roda a corrente de meses, do primeiro com dado ate' o pedido.
 *
 * A sobra e' DERIVADA, nunca gravada. Guardar o fechamento de cada mes seria
 * mais rapido e abriria a porta para o valor divergir dos lancamentos — que e' o
 * pior defeito possivel num app de dinheiro, porque nao quebra nada, so' mente.
 */
export function runMonths(flows: readonly MonthFlow[]): MonthCash[] {
  const saida: MonthCash[] = [];
  let carregado = cents(0);

  for (const flow of flows) {
    const mes = closeMonth(carregado, flow);
    saida.push(mes);
    carregado = mes.carryToNextCents;
  }

  return saida;
}

// ── custo de vida ────────────────────────────────────────────────────────────

/**
 * Custo de vida: quanto custa existir por mes.
 *
 * So' entram as cobrancas marcadas como obrigatorias. A media corre sobre os
 * meses que JA' tem dado — no primeiro mes ela e' o proprio mes; no segundo, a
 * media dos dois. E' assim que a meta da reserva de emergencia amadurece em vez
 * de nascer errada.
 *
 * Mes sem nenhuma conta obrigatoria nao entra na conta: seria um zero puxando a
 * media para baixo e sugerindo que se vive de graca.
 */
export function essentialAverage(monthlyTotals: readonly Cents[]): Cents {
  const comDado = monthlyTotals.filter((v) => v > 0);
  if (comDado.length === 0) return cents(0);
  return cents(Math.round(comDado.reduce<number>((a, v) => a + v, 0) / comDado.length));
}

/** Meta da reserva: seis meses do custo de vida medio. */
export const EMERGENCY_MONTHS = 6;

export function emergencyTarget(averageCents: Cents): Cents {
  return cents(averageCents * EMERGENCY_MONTHS);
}
