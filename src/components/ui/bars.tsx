import type { CSSProperties } from "react";
import { widthPercent } from "@/domain/math";
import s from "./bars.module.css";

/**
 * Barras.
 *
 * TODA largura passa por `widthPercent`, que trata denominador zero. O design
 * divide direto e produz `NaN%` em mes vazio, cartao sem fatura ou ativo sem
 * aporte — e uma largura `NaN%` invalida a regra CSS inteira.
 */

export function ProgressBar({
  value,
  total,
  color = "var(--pos-soft)",
  height = 8,
  label,
}: {
  value: number;
  total: number;
  color?: string;
  height?: number;
  /** Descricao acessivel. Sem ela a barra e' invisivel para leitor de tela. */
  label?: string;
}) {
  const percent = widthPercent(value, total);
  const fill = (
    <div
      className={s.fill}
      style={{ "--bar-w": `${percent.toFixed(2)}%`, "--bar-color": color } as CSSProperties}
    />
  );
  const trackStyle = { "--bar-h": `${height}px` } as CSSProperties;

  // Sem rotulo a barra e' ornamento: some do leitor de tela.
  if (!label) {
    return (
      <div className={s.track} style={trackStyle} aria-hidden="true">
        {fill}
      </div>
    );
  }

  /*
   * Com rotulo ha' um `<meter>` NATIVO, visualmente oculto, e a barra do design
   * como ornamento. Semantica nativa (melhor anunciada que `role="meter"`) sem
   * abrir mao do controle visual — estilizar `<meter>` diretamente exigiria
   * pseudo-elementos diferentes por navegador.
   */
  return (
    <>
      <meter className={s.srOnly} min={0} max={100} value={percent}>
        {label}: {Math.round(percent)}%
      </meter>
      <div className={s.track} style={trackStyle} aria-hidden="true">
        {fill}
      </div>
    </>
  );
}

export interface Segment {
  id: string;
  label: string;
  value: number;
  color: string;
}

export function StackedBar({
  segments,
  height = 10,
  gap = 2,
  label,
}: {
  segments: readonly Segment[];
  height?: number;
  gap?: number;
  label?: string;
}) {
  const total = segments.reduce((acc, seg) => acc + seg.value, 0);

  return (
    <div
      className={s.stacked}
      style={{ "--bar-h": `${height}px`, "--bar-gap": `${gap}px` } as CSSProperties}
      role="img"
      aria-label={label}
    >
      {segments.map((seg) => (
        <div
          key={seg.id}
          className={s.segment}
          style={
            {
              "--seg-w": `${widthPercent(seg.value, total).toFixed(2)}%`,
              "--seg-color": seg.color,
            } as CSSProperties
          }
          title={seg.label}
        />
      ))}
    </div>
  );
}
