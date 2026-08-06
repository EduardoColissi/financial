"use client";

import { useState } from "react";
import type { Cents } from "@/domain/money";
import { digitsFromCents, maskBRL, onlyDigits } from "@/lib/money-mask";

/**
 * Campo de dinheiro que se comporta como o do banco: digitos entram pela
 * direita e os separadores aparecem sozinhos. A mascara mora em
 * `@/lib/money-mask` porque o modal de lancamento precisa dela com estado
 * proprio.
 *
 * O valor enviado no submit e' o mascarado ("1.234,56"), que `parseBRL` le' sem
 * ambiguidade — nao ha' campo escondido para sair de sincronia com o visivel.
 */
export function MoneyInput({
  name,
  defaultCents,
  className,
  placeholder = "0,00",
  required,
  "aria-label": ariaLabel,
}: {
  name: string;
  /** Valor inicial. `null`/`undefined` deixa o campo vazio. */
  defaultCents?: Cents | number | null;
  className?: string;
  placeholder?: string;
  required?: boolean;
  "aria-label"?: string;
}) {
  const [digitos, setDigitos] = useState(() => digitsFromCents(defaultCents));

  return (
    <input
      name={name}
      className={className}
      // `inputMode="numeric"` e nao `type="number"`: o teclado numerico aparece
      // no celular, mas o campo continua sendo texto — `type="number"` recusaria
      // a virgula e brigaria com a formatacao.
      inputMode="numeric"
      autoComplete="off"
      value={maskBRL(digitos)}
      placeholder={placeholder}
      required={required}
      aria-label={ariaLabel}
      onChange={(e) => setDigitos(onlyDigits(e.target.value))}
    />
  );
}
