"use client";

import { useActionState, useEffect, useId, useState } from "react";
import {
  type PaymentState,
  payChargeAction,
  setChargeAmountAction,
  unpayChargeAction,
} from "@/app/actions/payments";
import { MoneyInput } from "@/components/ui/MoneyInput.client";
import type { Cents } from "@/domain/money";
import s from "./PayCharge.module.css";

const INICIAL: PaymentState = { ok: false };

/**
 * Pagar, desfazer e corrigir o valor de uma cobranca.
 *
 * A acao de pagar move dinheiro: por isso ela abre um painel com data e valor
 * em vez de um clique unico. O valor vem preenchido com o previsto — e' so'
 * confirmar quando bate, e digitar quando a conta de luz veio diferente.
 */
export function PayCharge({
  id,
  amountCents,
  paid,
  onCredit,
  hoje,
}: {
  id: string;
  amountCents: Cents;
  paid: boolean;
  /** Cobranca que cai em fatura nao se paga sozinha — o cartao a quita. */
  onCredit: boolean;
  hoje: string;
}) {
  const [aberto, setAberto] = useState(false);
  const [state, formAction, pending] = useActionState(payChargeAction, INICIAL);
  const [ajuste, ajusteAction, ajustando] = useActionState(setChargeAmountAction, INICIAL);
  // Uma destas por cobranca na lista: id fixo colidiria.
  const valorId = useId();

  useEffect(() => {
    if (state.ok || ajuste.ok) setAberto(false);
  }, [state.ok, ajuste.ok]);

  if (onCredit) {
    return (
      <span className={s.hint} title="Quitada quando a fatura do cartão for paga">
        na fatura
      </span>
    );
  }

  if (paid) {
    return (
      <form action={unpayChargeAction}>
        <input type="hidden" name="id" value={id} />
        <button type="submit" className={s.ghost}>
          Desfazer
        </button>
      </form>
    );
  }

  if (!aberto) {
    return (
      <button type="button" className={s.pay} onClick={() => setAberto(true)}>
        Pagar
      </button>
    );
  }

  return (
    <div className={s.panel}>
      <form action={formAction} className={s.inline}>
        <input type="hidden" name="id" value={id} />
        <label className={s.field} htmlFor={valorId}>
          <span className={s.label}>Valor pago</span>
          <MoneyInput id={valorId} name="amount" className={s.input} defaultCents={amountCents} />
        </label>
        <label className={s.field}>
          <span className={s.label}>Em</span>
          <input name="paidOn" type="date" className={s.input} defaultValue={hoje} />
        </label>
        <button type="submit" className={s.pay} disabled={pending}>
          {pending ? "Pagando…" : "Confirmar"}
        </button>
      </form>

      {/*
        Corrigir sem pagar: a conta de luz chega com valor diferente do previsto
        dias antes do vencimento, e forçar o pagamento só para registrar o valor
        certo faria o caixa cair antes da hora.
      */}
      <form action={ajusteAction} className={s.inline}>
        <input type="hidden" name="id" value={id} />
        <MoneyInput
          name="amount"
          className={s.input}
          defaultCents={amountCents}
          aria-label="Corrigir valor previsto"
        />
        <button type="submit" className={s.ghost} disabled={ajustando}>
          Só corrigir o valor
        </button>
      </form>

      <button type="button" className={s.ghost} onClick={() => setAberto(false)}>
        Cancelar
      </button>

      {state.error || ajuste.error ? (
        <p className={s.error} role="alert">
          {state.error ?? ajuste.error}
        </p>
      ) : null}
    </div>
  );
}
