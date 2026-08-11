import { type Cents, cents } from "./money";
import type { PlainDate } from "./period";

/**
 * Divisao da sobra entre os setores de investimento.
 *
 * O dinheiro que sobra no fim do mes vira aporte, repartido pelas fatias que o
 * dono configurou. Modulo puro: a parte que erra calado aqui e' o ARREDONDAMENTO
 * — dividir R$ 1.000,00 em tres fatias de 33% perde centavos, e centavo perdido
 * num app de dinheiro e' bug que ninguem ve' ate' a conciliacao.
 */

export interface SectorShare {
  id: string;
  sharePercent: number;
}

export interface SectorAllocation {
  id: string;
  amountCents: Cents;
}

/**
 * Reparte `total` pelas fatias, sem perder nem inventar um centavo.
 *
 * A sobra da divisao inteira vai para o setor de MAIOR fatia. Espalhar o resto
 * por varios setores produziria numeros com centavo aleatorio; concentrar num
 * so' mantem o resto legivel e a soma exata.
 *
 * Fatias que nao somam 100 sao respeitadas como estao: se o dono configurou 80%,
 * 20% da sobra fica em caixa. Normalizar para 100 seria decidir por ele.
 */
export function allocate(totalCents: Cents, sectors: readonly SectorShare[]): SectorAllocation[] {
  const validos = sectors.filter((s) => s.sharePercent > 0);
  if (validos.length === 0 || totalCents <= 0) {
    return sectors.map((s) => ({ id: s.id, amountCents: cents(0) }));
  }

  const porSetor = new Map<string, number>();
  let distribuido = 0;

  for (const setor of validos) {
    // `Math.floor` em todas: garante que a soma nunca ULTRAPASSE o total, e o
    // que faltar seja distribuido de propósito em vez de por acidente.
    const parte = Math.floor((totalCents * setor.sharePercent) / 100);
    porSetor.set(setor.id, parte);
    distribuido += parte;
  }

  const alvo = Math.floor((totalCents * somaFatias(validos)) / 100);
  const resto = alvo - distribuido;
  if (resto > 0) {
    const maior = [...validos].sort(
      (a, b) => b.sharePercent - a.sharePercent || a.id.localeCompare(b.id)
    )[0];
    if (maior) porSetor.set(maior.id, (porSetor.get(maior.id) ?? 0) + resto);
  }

  return sectors.map((s) => ({ id: s.id, amountCents: cents(porSetor.get(s.id) ?? 0) }));
}

export function somaFatias(sectors: readonly SectorShare[]): number {
  return sectors.reduce<number>((a, s) => a + s.sharePercent, 0);
}

/** Fatias somando mais de 100% prometeriam mais dinheiro do que existe. */
export function sharesAreValid(sectors: readonly SectorShare[]): boolean {
  return somaFatias(sectors) <= 100;
}

// ── progresso rumo ao objetivo ───────────────────────────────────────────────

/**
 * O acumulado do setor: o que ja' existia + o que foi aportado pelo app.
 *
 * O saldo de abertura e' dinheiro que saiu de um caixa que o app nunca viu.
 * Somar aqui e' o ponto: a meta passa a ser medida contra o patrimonio de
 * verdade. Descontar do caixa e' que seria errado — cobraria de novo uma
 * despesa ja' paga la' atras.
 */
export function accumulated(openingCents: Cents, contributedCents: Cents): Cents {
  return cents(Math.max(0, openingCents) + contributedCents);
}

export interface SectorProgress {
  accumulatedCents: Cents;
  targetCents: Cents;
  percent: number;
  missingCents: Cents;
  /** Meses restantes ate' a data-alvo. `null` quando nao ha' prazo. */
  monthsLeft: number | null;
  /** Quanto teria que entrar por mes para chegar no prazo. */
  neededPerMonthCents: Cents | null;
  reached: boolean;
}

/** Meses cheios entre duas datas civis, nunca negativo. */
function monthsBetweenDates(from: PlainDate, to: PlainDate): number {
  const a = from.split("-").map(Number);
  const b = to.split("-").map(Number);
  const anos = (b[0] ?? 0) - (a[0] ?? 0);
  const meses = (b[1] ?? 0) - (a[1] ?? 0);
  return Math.max(0, anos * 12 + meses);
}

/**
 * Quanto do objetivo do ANO ja' entrou.
 *
 * Pergunta diferente da meta total, e por isso um numero proprio: um setor pode
 * estar a 8% do objetivo de uma vida inteira e em dia com o ano. Sem este
 * indicador, so' o primeiro numero aparece — e ele desanima em janeiro sem
 * informar nada sobre o ritmo.
 */
export interface AnnualProgress {
  investedCents: Cents;
  targetCents: Cents;
  percent: number;
  missingCents: Cents;
  reached: boolean;
}

export function annualProgress(investedCents: Cents, targetCents: Cents): AnnualProgress {
  return {
    investedCents,
    targetCents,
    // Meta zero e' meta NAO DEFINIDA, nao meta cumprida: devolver 100 aqui
    // pintaria a barra cheia em todo setor sem objetivo anual.
    percent: targetCents > 0 ? Math.min(100, (investedCents / targetCents) * 100) : 0,
    missingCents: cents(Math.max(0, targetCents - investedCents)),
    reached: targetCents > 0 && investedCents >= targetCents,
  };
}

export function sectorProgress(
  accumulatedCents: Cents,
  targetCents: Cents,
  today: PlainDate,
  targetDate: PlainDate | null
): SectorProgress {
  const falta = Math.max(0, targetCents - accumulatedCents);
  const meses = targetDate ? monthsBetweenDates(today, targetDate) : null;

  return {
    accumulatedCents,
    targetCents,
    // Meta zero nao e' 0% nem 100%: e' meta nao definida. Devolver 0 evita
    // divisao por zero e barra cheia mentindo que o objetivo foi atingido.
    percent: targetCents > 0 ? Math.min(100, (accumulatedCents / targetCents) * 100) : 0,
    missingCents: cents(falta),
    monthsLeft: meses,
    neededPerMonthCents:
      meses != null && meses > 0
        ? cents(Math.ceil(falta / meses))
        : meses === 0
          ? cents(falta)
          : null,
    reached: targetCents > 0 && accumulatedCents >= targetCents,
  };
}
