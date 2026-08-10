"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { type RegistryFormState, saveRecurringAction } from "@/app/actions/registry";
import { MoneyInput } from "@/components/ui/MoneyInput.client";
import {
  PAYMENT_METHOD_LABEL,
  PAYMENT_METHODS,
  RECURRENCE_KIND_LABEL,
  RECURRENCE_KINDS,
  type RecurrenceKind,
} from "@/domain/registry";
import type { AccountRow, CardRow, CategoryRow, RecurringRow } from "@/services/registry";
import s from "./Registry.module.css";

const INICIAL: RegistryFormState = { ok: false };

function Erro({ state, campo }: { state: RegistryFormState; campo: string }) {
  if (state.ok || state.field !== campo || !state.error) return null;
  return (
    <p className={s.fieldError} role="alert">
      {state.error}
    </p>
  );
}

/**
 * Conta fixa e assinatura no mesmo formulario.
 *
 * O tipo escolhido troca metade dos campos: conta pede forma de pagamento e
 * conta de debito; assinatura pede cartao e nada mais, porque o meio ja' e' o
 * credito. Dois formularios separados duplicariam categoria, dia, valor,
 * parcelas e a flag de obrigatoria — e um deles ficaria para tras.
 */
export function RecurringForm({
  regra,
  categorias,
  contas,
  cartoes,
  mesCorrente,
  onDone,
}: {
  regra?: RecurringRow;
  categorias: CategoryRow[];
  contas: AccountRow[];
  cartoes: CardRow[];
  mesCorrente: string;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveRecurringAction, INICIAL);
  const [kind, setKind] = useState<RecurrenceKind>(regra?.kind ?? "bill");
  const [variavel, setVariavel] = useState(regra?.isVariable ?? false);
  const valorId = `${useId()}-valor`;

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const valorAtual = regra?.isVariable ? regra.estimatedCents : regra?.amountCents;
  const gastos = categorias.filter((c) => c.kind === "expense");

  return (
    <form action={formAction} className={s.form}>
      {regra ? <input type="hidden" name="id" value={regra.id} /> : null}

      <div className={s.grid}>
        <label className={s.field}>
          <span className={s.label}>Nome</span>
          <input
            name="name"
            className={s.input}
            defaultValue={regra?.name ?? ""}
            placeholder="Aluguel"
            maxLength={40}
            required
          />
          <Erro state={state} campo="name" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Tipo</span>
          <select
            name="kind"
            className={s.input}
            value={kind}
            onChange={(e) => setKind(e.target.value as RecurrenceKind)}
          >
            {RECURRENCE_KINDS.map((k) => (
              <option key={k} value={k}>
                {RECURRENCE_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <Erro state={state} campo="kind" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Categoria</span>
          <select name="categoryId" className={s.input} defaultValue={regra?.categoryId ?? ""}>
            <option value="">— escolha —</option>
            {gastos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <Erro state={state} campo="categoryId" />
        </label>

        {kind === "bill" ? (
          <>
            <label className={s.field}>
              <span className={s.label}>Sai da conta</span>
              <select name="accountId" className={s.input} defaultValue={regra?.accountId ?? ""}>
                <option value="">— escolha —</option>
                {contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <Erro state={state} campo="accountId" />
            </label>

            <label className={s.field}>
              <span className={s.label}>Forma</span>
              <select name="method" className={s.input} defaultValue={regra?.method ?? "pix"}>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </option>
                ))}
              </select>
              <Erro state={state} campo="method" />
            </label>
          </>
        ) : (
          <label className={s.field}>
            <span className={s.label}>Cai no cartão</span>
            <select name="cardId" className={s.input} defaultValue={regra?.cardId ?? ""}>
              <option value="">— escolha —</option>
              {cartoes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className={s.hint}>Só sai do caixa quando a fatura for paga.</span>
            <Erro state={state} campo="cardId" />
          </label>
        )}

        <label className={s.field}>
          <span className={s.label}>Dia de vencimento</span>
          <input
            name="dueDay"
            type="number"
            min={1}
            max={31}
            className={s.input}
            defaultValue={regra?.dueDay ?? 1}
            required
          />
          <Erro state={state} campo="dueDay" />
        </label>

        <label className={s.field} htmlFor={valorId}>
          <span className={s.label}>{variavel ? "Estimativa" : "Valor"}</span>
          <MoneyInput
            id={valorId}
            name="amount"
            className={s.input}
            defaultCents={valorAtual}
            required
          />
          <span className={s.hint}>
            {variavel ? "O real você digita no mês." : "Mesmo valor todo mês."}
          </span>
          <Erro state={state} campo="amount" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Começou em</span>
          <input
            name="firstRefMonth"
            type="month"
            className={s.input}
            defaultValue={regra?.firstRefMonth?.slice(0, 7) ?? mesCorrente}
            required
          />
          <span className={s.hint}>Define de que parcela estamos hoje.</span>
          <Erro state={state} campo="firstRefMonth" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Parcelas</span>
          <input
            name="installments"
            type="number"
            min={2}
            max={120}
            className={s.input}
            defaultValue={regra?.installmentsTotal ?? ""}
            placeholder="sem fim"
          />
          <span className={s.hint}>Em branco = não acaba.</span>
          <Erro state={state} campo="installments" />
        </label>
      </div>

      <label className={s.check}>
        <input
          type="checkbox"
          name="isVariable"
          defaultChecked={regra?.isVariable ?? false}
          onChange={(e) => setVariavel(e.target.checked)}
        />
        <span>
          Valor muda todo mês
          <span className={s.hint}> — luz, água, gás</span>
        </span>
      </label>

      {/*
        A flag que alimenta a reserva de emergência. Aluguel e luz entram;
        streaming não. Somar o que dá para cortar inflaria a meta e faria você
        guardar dinheiro para manter assinatura em crise.
      */}
      <label className={s.check}>
        <input type="checkbox" name="essential" defaultChecked={regra?.essential ?? false} />
        <span>
          Conta obrigatória
          <span className={s.hint}> — entra no custo de vida e na reserva de emergência</span>
        </span>
      </label>

      {state.error && !state.field ? (
        <p className={s.fieldError} role="alert">
          {state.error}
        </p>
      ) : null}

      <div className={s.actions}>
        <button type="submit" className={s.primary} disabled={pending}>
          {pending ? "Salvando…" : regra ? "Salvar" : "Criar"}
        </button>
        <button type="button" className={s.ghost} onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
