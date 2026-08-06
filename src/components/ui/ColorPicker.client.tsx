"use client";

import { useState } from "react";
import { isPaletteColor, PALETTE, PALETTE_HEX } from "@/domain/registry";
import s from "./ColorPicker.module.css";

/**
 * Escolha de cor: oito atalhos mais cor livre.
 *
 * As oito continuam porque sao boas por construcao — mesma claridade percebida,
 * legiveis sobre o painel escuro, e o formulario ja' abre com uma que ninguem
 * usou. O seletor nativo entra ao lado para quando nenhuma das oito serve.
 *
 * A cor livre e' um NONO radio, nao um campo separado: assim o grupo continua
 * sendo um radiogroup nativo (navegacao por setas, leitor de tela) e o
 * formulario tem um valor so' — nao ha' dois campos para sair de sincronia.
 */
export function ColorPicker({ name, atual }: { name: string; atual: string }) {
  const [cor, setCor] = useState(atual);
  const preset = isPaletteColor(cor);

  // `<input type="color">` so' fala hex. Com um preset escolhido ele abre no
  // equivalente aproximado — e' ponto de PARTIDA do seletor, nunca o valor
  // gravado: clicar num preset grava o oklch original, mais vivo em tela P3.
  const hex = (preset ? PALETTE_HEX[cor] : cor) ?? PALETTE_HEX[PALETTE[0]] ?? "#888888";

  return (
    <div className={s.wrap}>
      <div className={s.swatches} role="radiogroup" aria-label="Cor">
        {PALETTE.map((c, i) => (
          <label key={c} className={s.swatch} style={{ background: c }}>
            <input
              type="radio"
              name={name}
              value={c}
              checked={cor === c}
              onChange={() => setCor(c)}
            />
            <span className={s.check} aria-hidden="true" />
            <span className={s.sr}>{`Cor ${i + 1}`}</span>
          </label>
        ))}

        <label className={`${s.swatch} ${s.free}`} style={{ background: hex }}>
          <input
            type="radio"
            name={name}
            value={hex}
            checked={!preset}
            onChange={() => setCor(hex)}
          />
          <span className={s.check} aria-hidden="true" />
          <span className={s.sr}>Cor personalizada</span>
        </label>
      </div>

      <label className={s.custom}>
        <input
          type="color"
          className={s.native}
          value={hex}
          onChange={(e) => setCor(e.target.value)}
          aria-label="Escolher outra cor"
        />
        <span>Outra cor</span>
      </label>
    </div>
  );
}
