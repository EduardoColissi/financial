/**
 * Razoes seguras.
 *
 * O design tem seis divisoes por zero herdadas do mock — donut, uso de limite,
 * rendimento percentual, ganho percentual, % de contas pagas e meses de reserva.
 * Com dados reais (mes sem despesa, cartao sem fatura, ativo sem aporte) elas
 * viram `NaN` ou `Infinity`. A pior e' a do donut: a string do `conic-gradient`
 * sai com `NaN%`, o CSS inteiro fica invalido e o grafico desaparece.
 *
 * Regra do projeto: nenhuma divisao direta em codigo de apresentacao.
 */

export function safeRatio(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return fallback;
  }
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}

/** Razao em porcentagem (0..100 tipicamente), com o mesmo cuidado. */
export function safePercent(numerator: number, denominator: number, fallback = 0): number {
  return safeRatio(numerator, denominator, fallback / 100) * 100;
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Percentual pronto para virar largura de CSS, sempre em [0, 100]. */
export function widthPercent(numerator: number, denominator: number): number {
  return clamp(safePercent(numerator, denominator), 0, 100);
}
