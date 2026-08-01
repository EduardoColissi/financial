"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cx } from "@/lib/cx";
import s from "./Transactions.module.css";

/**
 * Chips de filtro.
 *
 * Escrevem na URL; quem filtra e' o servidor. O design filtra no cliente
 * (linha 1218), o que so' funciona com 15 linhas em memoria.
 */
export function FilterChips({
  param,
  options,
  current,
  label,
}: {
  param: string;
  options: ReadonlyArray<readonly [string, string]>;
  current: string;
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function select(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === "todos") next.delete(param);
    else next.set(param, value);
    const qs = next.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    // <fieldset> em vez de div[role=group]: e' o elemento nativo para um
    // conjunto de controles, e o <legend> da' o nome acessivel sem aria-label.
    <fieldset className={s.chips} style={{ opacity: pending ? 0.6 : 1 }}>
      <legend className={s.srOnly}>{label}</legend>
      {options.map(([value, text]) => (
        <button
          key={value}
          type="button"
          className={cx(s.chip, current === value && s.chipActive)}
          aria-pressed={current === value}
          onClick={() => select(value)}
        >
          {text}
        </button>
      ))}
    </fieldset>
  );
}
