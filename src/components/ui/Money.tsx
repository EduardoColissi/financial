import type { Cents, FlowKind } from "@/domain/money";
import { brl, brl0, pct as fmtPct, pp as fmtPp, MASK, signedBrl } from "@/domain/money";
import { cx } from "@/lib/cx";
import s from "./Money.module.css";

export type MoneySize = "xl" | "lg" | "md" | "sm" | "xs";
export type MoneyTone = "default" | "pos" | "neg" | "info" | "muted" | "onAccent";

export interface MoneyProps {
  cents: Cents;
  size?: MoneySize;
  tone?: MoneyTone;
  /** `auto` usa o sinal do proprio valor; informe `kind` para o formato do design. */
  kind?: FlowKind;
  /** Sem casas decimais (o `brl0` do design). */
  compact?: boolean;
}

/**
 * Valor monetario.
 *
 * Server Component. Recebe centavos crus e formata aqui — nenhuma prop
 * `*Fmt` cruza fronteira de componente, que e' o que o design faz em
 * `renderVals()` e o que impediria trocar formato ou testar de forma isolada.
 */
export function Money({ cents, size = "sm", tone = "default", kind, compact }: MoneyProps) {
  const text = kind ? signedBrl(cents, kind) : compact ? brl0(cents) : brl(cents);

  return (
    <span className={cx(s.money, s[size], s[tone])}>
      <span className={s.value}>{text}</span>
      <span className={s.mask} aria-hidden="true">
        {MASK}
      </span>
    </span>
  );
}

export interface PctProps {
  value: number;
  tone?: MoneyTone;
  /** Formata como pontos percentuais com sinal (desvio de alocacao). */
  asPoints?: boolean;
}

export function Pct({ value, tone = "default", asPoints }: PctProps) {
  return (
    <span className={cx(s.money, s.xs, s[tone])}>{asPoints ? fmtPp(value) : fmtPct(value)}</span>
  );
}
