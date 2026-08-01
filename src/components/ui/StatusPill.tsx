import type { ReactNode } from "react";
import type { Tone } from "@/domain/status";
import { cx } from "@/lib/cx";
import s from "./StatusPill.module.css";

/**
 * Pill de status.
 *
 * Recebe o TOM (enum do dominio), nunca cores prontas. No design cada linha
 * carrega `stBg`/`stFg` calculados em `renderVals()`, o que espalha decisao
 * visual pela camada de dados.
 */
export function StatusPill({ tone, children }: { tone: Tone | "sub"; children: ReactNode }) {
  return <span className={cx(s.pill, s[tone])}>{children}</span>;
}
