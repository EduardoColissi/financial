"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { createEntryAction, type EntryFormState } from "@/app/actions/entries";
import { type Cents, MoneyError, parseBRL, ZERO } from "@/domain/money";
import {
  allowsInstallments,
  categoryKindOf,
  ENTRY_TYPES,
  type EntryMethod,
  type EntryType,
  effectHint,
  METHOD_LABELS,
  methodsFor,
  planEntry,
  previewOf,
} from "@/domain/new-entry";
import { type PlainDate, plainDate } from "@/domain/period";
import { cx } from "@/lib/cx";
import type { EntryFormOptions } from "@/services/entry-form";
import s from "./NewEntry.module.css";

/**
 * Modal de novo lancamento — o unico caminho de escrita do painel.
 *
 * Vive na URL (`?novo=1`): abre de qualquer aba, e' compartilhavel e o botao
 * voltar do navegador fecha. O design guarda `modal: true` em estado local
 * (linha 1133), o que perde o modal a cada navegacao e ignora o botao voltar.
 *
 * A previa chama `planEntry`/`previewOf` — as MESMAS funcoes que a Server Action
 * usa para gravar. No design a previa calcula `nvVal / nvParc` em float e o
 * salvar monta o objeto por outro caminho: o numero prometido nao e' o gravado.
 */

const INITIAL: EntryFormState = { ok: true };

/** Le' o valor digitado sem explodir enquanto o usuario ainda esta' digitando. */
function readAmount(raw: string): Cents {
  if (!raw.trim()) return ZERO;
  try {
    const value = parseBRL(raw);
    return value > 0 ? value : ZERO;
  } catch (err) {
    if (err instanceof MoneyError) return ZERO;
    throw err;
  }
}

function readDate(raw: string, fallback: PlainDate): PlainDate {
  try {
    return plainDate(raw);
  } catch {
    return fallback;
  }
}

export function NewEntryModal({ options }: { options: EntryFormOptions }) {
  const params = useSearchParams();
  const open = params.get("novo") === "1";
  if (!open) return null;
  // Remonta a cada abertura — e' o que zera o formulario sem um efeito de reset.
  return <Dialog options={options} />;
}

function Dialog({ options }: { options: EntryFormOptions }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(createEntryAction, INITIAL);

  const firstAccount = options.accounts[0];
  const firstCard = options.cards[0];

  const [type, setType] = useState<EntryType>("despesa");
  const [method, setMethod] = useState<EntryMethod>("pix");
  const [target, setTarget] = useState(firstAccount ? `acc:${firstAccount.id}` : "");
  const [categoryId, setCategoryId] = useState(
    () => options.categories.find((c) => c.kind === "expense")?.id ?? ""
  );
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [occurredOn, setOccurredOn] = useState<string>(options.defaultDate);
  const [installments, setInstallments] = useState(1);
  const [repeats, setRepeats] = useState(false);

  // <dialog> nativo: prisao de foco, Escape e camada de topo vem do navegador.
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);

  function close() {
    const next = new URLSearchParams(params.toString());
    next.delete("novo");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  const categories = options.categories.filter((c) => c.kind === categoryKindOf(type));
  const methods = methodsFor(type);
  const canInstall = allowsInstallments(type, method);
  const onCredit = target.startsWith("card:");

  /** Cartao so' com credito; qualquer outro meio sai de uma conta. */
  function syncTarget(nextMethod: EntryMethod) {
    const wantCard = nextMethod === "credit";
    if (wantCard && !target.startsWith("card:")) {
      setTarget(firstCard ? `card:${firstCard.id}` : "");
    } else if (!wantCard && !target.startsWith("acc:")) {
      setTarget(firstAccount ? `acc:${firstAccount.id}` : "");
    }
  }

  function selectType(next: EntryType) {
    setType(next);

    const allowed = methodsFor(next);
    const nextMethod = allowed.includes(method) ? method : (allowed[0] ?? "pix");
    setMethod(nextMethod);
    syncTarget(nextMethod);

    const kind = categoryKindOf(next);
    if (!options.categories.some((c) => c.id === categoryId && c.kind === kind)) {
      setCategoryId(options.categories.find((c) => c.kind === kind)?.id ?? "");
    }
    if (!allowsInstallments(next, nextMethod)) setInstallments(1);
  }

  function selectMethod(next: EntryMethod) {
    setMethod(next);
    syncTarget(next);
    if (!allowsInstallments(type, next)) setInstallments(1);
  }

  const amountCents = readAmount(amount);
  const plan =
    amountCents > 0
      ? planEntry({
          type,
          amountCents,
          method,
          onCredit,
          occurredOn: readDate(occurredOn, options.defaultDate),
          installments: canInstall ? installments : 1,
          repeats,
        })
      : null;

  const labels = {
    categoryName: categories.find((c) => c.id === categoryId)?.name ?? null,
    methodLabel: METHOD_LABELS[method],
    targetName:
      [...options.accounts, ...options.cards].find((o) => target.endsWith(o.id))?.name ?? null,
  };

  return (
    /*
     * Fechar clicando no backdrop e' atalho de mouse. O equivalente de teclado e'
     * o Esc, que o <dialog> nativo ja' trata e entrega pelo `onClose` abaixo — um
     * handler de teclado neste elemento seria redundante e ainda capturaria teclas
     * destinadas ao formulario.
     */
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc via onClose e' o equivalente de teclado
    <dialog
      ref={ref}
      className={s.dialog}
      aria-labelledby="novo-titulo"
      onClose={close}
      onClick={(e) => {
        // Clique no proprio <dialog> e', geometricamente, clique no backdrop:
        // o conteudo esta' todo dentro do <form>.
        if (e.target === ref.current) close();
      }}
    >
      <form action={formAction} className={s.form}>
        <div className={s.head}>
          <div>
            <h2 className={s.title} id="novo-titulo">
              Novo lançamento
            </h2>
            <span className={s.subtitle}>receita, despesa ou aporte</span>
          </div>
          <button type="button" className={s.close} onClick={close} aria-label="Fechar">
            ×
          </button>
        </div>

        <div className={s.body}>
          <fieldset className={s.segments}>
            <legend className={s.srOnly}>Tipo de lançamento</legend>
            {ENTRY_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                className={cx(s.segment, type === t.value && s.segmentActive)}
                aria-pressed={type === t.value}
                onClick={() => selectType(t.value)}
              >
                {t.label}
              </button>
            ))}
          </fieldset>

          <div className={s.pair}>
            <div className={s.field}>
              <label className={s.label} htmlFor="novo-valor">
                Valor
              </label>
              <div className={s.amountBox}>
                <span className={s.currency} aria-hidden="true">
                  R$
                </span>
                <input
                  id="novo-valor"
                  name="amount"
                  className={s.amountInput}
                  placeholder="0,00"
                  inputMode="decimal"
                  autoComplete="off"
                  // Sem isto o <dialog> foca o "×": abrir o modal e ja' poder
                  // digitar o valor e' o caminho de 90% dos usos. Foco inicial
                  // de modal, nao de pagina — nao rouba foco de quem navega.
                  autoFocus
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
            </div>

            <div className={s.field}>
              <label className={s.label} htmlFor="novo-desc">
                Descrição
              </label>
              <input
                id="novo-desc"
                name="description"
                className={s.input}
                placeholder="ex. mercado da esquina"
                maxLength={120}
                autoComplete="off"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <fieldset className={s.field}>
            <legend className={s.label}>Categoria</legend>
            <div className={s.chips}>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={cx(s.chip, categoryId === c.id && s.chipActive)}
                  aria-pressed={categoryId === c.id}
                  onClick={() => setCategoryId(c.id)}
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
              ))}
            </div>
          </fieldset>

          <div className={s.pair}>
            <fieldset className={s.field}>
              <legend className={s.label}>Meio de pagamento</legend>
              <div className={s.chips}>
                {methods.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={cx(s.chip, s.chipSquare, method === m && s.chipActive)}
                    aria-pressed={method === m}
                    onClick={() => selectMethod(m)}
                  >
                    {METHOD_LABELS[m]}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className={s.field}>
              <legend className={s.label}>{method === "credit" ? "Cartão" : "Conta"}</legend>
              <div className={s.chips}>
                {(method === "credit" ? options.cards : options.accounts).map((o) => {
                  const value = `${method === "credit" ? "card" : "acc"}:${o.id}`;
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

          <div className={s.trio}>
            <div className={s.field}>
              <label className={s.label} htmlFor="novo-data">
                Data
              </label>
              <input
                id="novo-data"
                name="occurredOn"
                type="date"
                className={cx(s.input, s.inputMono)}
                value={occurredOn}
                onChange={(e) => setOccurredOn(e.target.value)}
              />
            </div>

            <div className={s.field}>
              <label className={s.label} htmlFor="novo-parcelas">
                Parcelas
              </label>
              <input
                id="novo-parcelas"
                name="installments"
                type="number"
                min={1}
                max={48}
                className={cx(s.input, s.inputMono)}
                disabled={!canInstall}
                title={canInstall ? undefined : "Só dá para parcelar em crédito ou boleto."}
                value={canInstall ? installments : 1}
                onChange={(e) => setInstallments(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>

            <button
              type="button"
              className={cx(s.toggle, repeats && s.toggleOn)}
              aria-pressed={repeats}
              // Parcelar ja' e' repetir por N meses; ligar os dois criaria duas
              // regras para a mesma obrigacao.
              disabled={installments > 1 && canInstall}
              onClick={() => setRepeats((v) => !v)}
            >
              <span className={cx(s.track, repeats && s.trackOn)} aria-hidden="true">
                <i className={cx(s.knob, repeats && s.knobOn)} />
              </span>
              Repetir todo mês
            </button>
          </div>

          {state.ok ? null : <p className={s.error}>{state.error}</p>}

          <p className={cx(s.preview, !plan && s.previewEmpty)}>
            {plan ? previewOf(plan, labels) : "preencha o valor para ver a prévia"}
          </p>
        </div>

        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="target" value={target} />
        <input type="hidden" name="categoryId" value={categoryId} />
        {repeats && installments === 1 ? <input type="hidden" name="repeats" value="on" /> : null}

        <div className={s.foot}>
          <span className={s.hint}>
            {plan ? effectHint(plan, labels) : "nada é gravado até você salvar"}
          </span>
          <div className={s.actions}>
            <button type="button" className={s.cancel} onClick={close}>
              Cancelar
            </button>
            <button
              type="submit"
              className={s.save}
              disabled={pending || !plan || !categoryId || !target}
            >
              {pending ? "Salvando…" : "Salvar lançamento"}
            </button>
          </div>
        </div>
      </form>
    </dialog>
  );
}

/**
 * Botao que abre o modal.
 *
 * E' um <Link>, nao um onClick: preserva os filtros que ja' estao na URL, entra
 * no historico (o botao voltar fecha o modal) e funciona com clique do meio.
 */
export function NewEntryButton({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const next = new URLSearchParams(params.toString());
  next.set("novo", "1");

  return (
    <Link href={`${pathname}?${next.toString()}`} className={className} scroll={false}>
      {children}
    </Link>
  );
}
