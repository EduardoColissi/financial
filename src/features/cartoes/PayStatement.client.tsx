"use client";

import { useActionState, useId, useState } from "react";
import {
  type PaymentState,
  payStatementAction,
  unpayStatementAction,
} from "@/app/actions/payments";
import { MoneyInput } from "@/components/ui/MoneyInput.client";
import type { Cents } from "@/domain/money";
import s from "./PayStatement.module.css";

const INICIAL: PaymentState = { ok: false };

/**
 * Pagamento da fatura — o unico momento em que dinheiro de cartao sai do caixa.
 *
 * Nao pergunta de qual conta sai: o dinheiro e' um so'. Pergunta o valor, que
 * cobre pagamento parcial e fatura que fechou com juros.
 */
export function PayStatement({
  statementId,
  amountCents,
  paid,
  hoje,
}: {
  statementId: string | null;
  amountCents: Cents;
  paid: boolean;
  hoje: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [state, formAction, pending] = useActionState(payStatementAction, INICIAL);
  // Um painel destes por cartao na mesma pagina: id fixo colidiria.
  const valorId = useId();

  // Sem fatura materializada nao ha' o que pagar — acontece em mes sem ciclo.
  if (!statementId) return null;

  if (paid) {
    return (
      <form action={unpayStatementAction} className={s.wrap}>
        <input type="hidden" name="id" value={statementId} />
        <span className={s.done}>Fatura paga</span>
        <button type="submit" className={s.ghost}>
          Reabrir
        </button>
      </form>
    );
  }

  if (!aberto) {
    return (
      <div className={s.wrap}>
        <button type="button" className={s.pay} onClick={() => setAberto(true)}>
          Pagar fatura
        </button>
      </div>
    );
  }

  return (
    <form action={formAction} className={s.panel}>
      <input type="hidden" name="id" value={statementId} />

      <label className={s.field} htmlFor={valorId}>
        <span className={s.label}>Valor</span>
        <MoneyInput id={valorId} name="amount" defaultCents={amountCents} className={s.input} />
      </label>

      <label className={s.field}>
        <span className={s.label}>Em</span>
        <input name="paidOn" type="date" className={s.input} defaultValue={hoje} />
      </label>

      <button type="submit" className={s.pay} disabled={pending}>
        {pending ? "Pagando…" : "Confirmar"}
      </button>
      <button type="button" className={s.ghost} onClick={() => setAberto(false)}>
        Cancelar
      </button>

      {state.error ? (
        <p className={s.error} role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
