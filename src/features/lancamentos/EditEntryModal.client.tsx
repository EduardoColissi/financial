"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { type EntryFormState, updateEntryAction } from "@/app/actions/entries";
import { canEdit } from "@/domain/entry-edit";
import { type EntryMethod, type EntryType, METHOD_LABELS, methodsFor } from "@/domain/new-entry";
import { cx } from "@/lib/cx";
import { centsFromDigits, digitsFromCents, maskBRL, onlyDigits } from "@/lib/money-mask";
import type { EntryFormOptions } from "@/services/entry-form";
import type { TransactionRow } from "@/services/queries";
import s from "./NewEntry.module.css";

// `ok: false` sem `error` e' o estado "ainda nao enviou". Precisa ser distinto
// de "salvou", que e' o que fecha o modal.
const INITIAL: EntryFormState = { ok: false };

/** `expense` -> `despesa`, para reusar as regras de meio de pagamento. */
function typeOf(kind: string): EntryType {
  if (kind === "income") return "receita";
  if (kind === "investment_out") return "aporte";
  return "despesa";
}

/** Por que metade dos campos sumiu. Dizer isso e' melhor do que desabilitar. */
const AVISO: Record<string, string> = {
  charge:
    "Este lançamento é o pagamento de uma conta a pagar. Categoria e conta vêm da regra — mude lá se precisar.",
  statement:
    "Este lançamento é o pagamento de uma fatura. O que dá para ajustar aqui é o valor pago e a data.",
};

/**
 * Edicao de um lancamento existente.
 *
 * Nao oferece parcelas nem "repetir todo mes": as duas coisas criam uma REGRA, e
 * transformar um lancamento avulso em regra por edicao seria criar outro objeto.
 *
 * Os campos visiveis saem de `editableFields` — a MESMA funcao que o servico usa
 * para decidir o que aceita. Esconder na tela evita o engano; ignorar no servico
 * barra o POST fabricado. As duas coisas, com uma regra so'.
 */
export function EditEntryModal({
  row,
  options,
}: {
  row: TransactionRow;
  options: EntryFormOptions;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(updateEntryAction, INITIAL);

  const [amount, setAmount] = useState(() => digitsFromCents(row.amountCents));
  const [description, setDescription] = useState(row.description);
  const [occurredOn, setOccurredOn] = useState<string>(row.occurredOn);
  const [categoryId, setCategoryId] = useState(row.categoryId ?? "");
  const [sectorId, setSectorId] = useState(row.sectorId ?? "");
  const [target, setTarget] = useState(
    row.cardId ? `card:${row.cardId}` : row.accountId ? `acc:${row.accountId}` : ""
  );
  const [method, setMethod] = useState(row.method as EntryMethod);

  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("editar");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  // Fecha sozinho quando o servidor confirma — sem isto o modal ficaria aberto
  // sobre uma lista que ja' mostra o valor novo atras dele.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `close` remonta a cada render
  useEffect(() => {
    if (state.ok) close();
  }, [state.ok]);

  const podeValor = canEdit(row.link, "amount");
  const podeCategoria = canEdit(row.link, "category");
  const podeDestino = canEdit(row.link, "target");
  const aviso = AVISO[row.link.kind];

  // Aporte escolhe setor no lugar de categoria — mesmo campo, outro cadastro.
  const porSetor = row.kind === "investment_out" || row.kind === "investment_in";
  const opcoes = porSetor
    ? options.sectors
    : options.categories.filter((c) => c.kind === (row.kind === "income" ? "income" : "expense"));
  const onCredit = target.startsWith("card:");

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc via onClose e' o equivalente de teclado
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby="editar-titulo"
      onClose={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <form action={formAction} className={s.form}>
        <input type="hidden" name="id" value={row.id} />

        <div className={s.head}>
          <div>
            <h2 className={s.title} id="editar-titulo">
              Editar lançamento
            </h2>
            <span className={s.subtitle}>corrigir o que foi lançado</span>
          </div>
          <button type="button" className={s.close} onClick={close} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className={s.body}>
          {aviso ? <p className={s.preview}>{aviso}</p> : null}

          <div className={s.pair}>
            <div className={s.field}>
              <label className={s.label} htmlFor="editar-valor">
                Valor
              </label>
              <div className={s.amountBox}>
                <span className={s.currency} aria-hidden="true">
                  R$
                </span>
                <input
                  id="editar-valor"
                  name="amount"
                  className={s.amountInput}
                  placeholder="0,00"
                  inputMode="numeric"
                  autoComplete="off"
                  readOnly={!podeValor}
                  value={maskBRL(amount)}
                  onChange={(e) => setAmount(onlyDigits(e.target.value))}
                />
              </div>
            </div>

            <div className={s.field}>
              <label className={s.label} htmlFor="editar-desc">
                Descrição
              </label>
              <input
                id="editar-desc"
                name="description"
                className={s.input}
                maxLength={120}
                autoComplete="off"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          {podeCategoria ? (
            <fieldset className={s.field}>
              <legend className={s.label}>{porSetor ? "Setor" : "Categoria"}</legend>
              <div className={s.chips}>
                {opcoes.map((c) => {
                  const escolhido = porSetor ? sectorId === c.id : categoryId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={cx(s.chip, escolhido && s.chipActive)}
                      aria-pressed={escolhido}
                      onClick={() => (porSetor ? setSectorId(c.id) : setCategoryId(c.id))}
                    >
                      <i
                        aria-hidden="true"
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 2,
                          display: "block",
                          background: c.color,
                        }}
                      />
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          {podeDestino ? (
            <div className={s.pair}>
              <fieldset className={s.field}>
                <legend className={s.label}>Meio de pagamento</legend>
                <div className={s.chips}>
                  {methodsFor(typeOf(row.kind)).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={cx(s.chip, s.chipSquare, method === m && s.chipActive)}
                      aria-pressed={method === m}
                      onClick={() => {
                        setMethod(m);
                        // Cartao so' com credito; qualquer outro meio sai de conta.
                        if (m === "credit" && !target.startsWith("card:")) {
                          const c = options.cards[0];
                          setTarget(c ? `card:${c.id}` : "");
                        } else if (m !== "credit" && !target.startsWith("acc:")) {
                          const a = options.accounts[0];
                          setTarget(a ? `acc:${a.id}` : "");
                        }
                      }}
                    >
                      {METHOD_LABELS[m]}
                    </button>
                  ))}
                </div>
              </fieldset>

              <fieldset className={s.field}>
                <legend className={s.label}>{onCredit ? "Cartão" : "Conta"}</legend>
                <div className={s.chips}>
                  {(onCredit ? options.cards : options.accounts).map((o) => {
                    const value = `${onCredit ? "card" : "acc"}:${o.id}`;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        className={cx(s.chip, s.chipSquare, target === value && s.chipActive)}
                        aria-pressed={target === value}
                        onClick={() => setTarget(value)}
                      >
                        {o.name}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          ) : null}

          <div className={s.field}>
            <label className={s.label} htmlFor="editar-data">
              Data
            </label>
            <input
              id="editar-data"
              name="occurredOn"
              type="date"
              className={cx(s.input, s.inputMono)}
              value={occurredOn}
              onChange={(e) => setOccurredOn(e.target.value)}
            />
          </div>

          {state.error ? <p className={s.error}>{state.error}</p> : null}
        </div>

        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="target" value={target} />
        <input type="hidden" name="categoryId" value={porSetor ? "" : categoryId} />
        <input type="hidden" name="sectorId" value={porSetor ? sectorId : ""} />

        <div className={s.foot}>
          <span className={s.hint}>
            {centsFromDigits(amount) > 0 ? "as somas do mês recalculam ao salvar" : "informe o valor"}
          </span>
          <div className={s.actions}>
            <button type="button" className={s.cancel} onClick={close}>
              Cancelar
            </button>
            <button
              type="submit"
              className={s.save}
              disabled={pending || centsFromDigits(amount) <= 0}
            >
              {pending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
