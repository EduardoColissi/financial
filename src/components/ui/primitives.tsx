import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/lib/cx";
import s from "./primitives.module.css";

/**
 * Primitivos sem dominio.
 *
 * Todos Server Components. Nenhum recebe cor pronta de fora exceto onde a cor
 * e' DADO (categoria, segmento) — nesse caso ela entra como custom property,
 * nunca como declaracao inline completa, para que hover e media query
 * continuem possiveis.
 */

export type CardPad = "none" | "sm" | "md" | "lg";

const padClass: Record<CardPad, string | undefined> = {
  none: s.padNone,
  sm: s.padSm,
  md: s.padMd,
  lg: s.padLg,
};

export function Card({
  children,
  pad = "md",
  className = "",
  style,
}: {
  children: ReactNode;
  pad?: CardPad;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={cx(s.card, padClass[pad], className)} style={style}>
      {children}
    </div>
  );
}

export function SectionHeader({
  title,
  sub,
  right,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <div className={s.sectionHeader}>
      <div>
        <h2 className={s.sectionTitle}>{title}</h2>
        {sub ? <p className={s.sectionSub}>{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

export function MicroLabel({ children }: { children: ReactNode }) {
  return <span className={s.microLabel}>{children}</span>;
}

/** Marcador colorido da categoria. A cor vem do banco, nao dos tokens. */
export function CategoryDot({ color, size = 9 }: { color: string; size?: number }) {
  return (
    <span
      className={s.dot}
      style={{ "--dot-color": color, "--dot-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    />
  );
}

/**
 * Estado vazio.
 *
 * O design nao tem nenhum — todo mock vem populado. Usa a mesma linguagem
 * visual (mono, tom apagado, dentro do card existente), sem inventar
 * ilustracao.
 */
export function EmptyState({ children }: { children: ReactNode }) {
  return <div className={s.empty}>{children}</div>;
}

export function Notice({ tone = "pos", children }: { tone?: "pos" | "warn"; children: ReactNode }) {
  const color = tone === "warn" ? "var(--warn)" : "var(--pos-soft)";
  return (
    <div className={s.notice}>
      <CategoryDot color={color} />
      <p className={s.noticeText}>{children}</p>
    </div>
  );
}
