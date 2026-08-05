"use client";

import { useActionState, useEffect, useId, useState } from "react";
import {
  deleteAccountAction,
  deleteCardAction,
  deleteCategoryAction,
  deleteRecurringAction,
  type RegistryFormState,
  saveAccountAction,
  saveCardAction,
  saveCategoryAction,
} from "@/app/actions/registry";
import { ColorPicker } from "@/components/ui/ColorPicker.client";
import { MoneyInput } from "@/components/ui/MoneyInput.client";
import { brl, cents } from "@/domain/money";
import {
  ACCOUNT_TYPE_LABEL,
  ACCOUNT_TYPES,
  type AccountType,
  CATEGORY_KIND_LABEL,
  CATEGORY_KINDS,
  type CategoryKind,
  daysOfFloat,
  PALETTE,
} from "@/domain/registry";
import type { AccountRow, CardRow, CategoryRow, Impacto, RecurringRow } from "@/services/registry";
import { RecurringForm } from "./RecurringForm.client";
import s from "./Registry.module.css";

const INICIAL: RegistryFormState = { ok: false };

/**
 * Cada formulario abre com uma cor ja' escolhida — nunca com nenhuma marcada, e
 * de preferencia uma que nenhum outro registro esteja usando: dois pontinhos da
 * mesma cor na lista nao identificam nada.
 */
function corPadrao(usadas: string[]): string {
  return PALETTE.find((c) => !usadas.includes(c)) ?? PALETTE[0];
}

function Erro({ state, campo }: { state: RegistryFormState; campo: string }) {
  if (state.ok || state.field !== campo || !state.error) return null;
  return (
    <p className={s.fieldError} role="alert">
      {state.error}
    </p>
  );
}

/** Mensagem que nao pertence a nenhum campo (nome duplicado, linha sumida). */
function ErroGeral({ state }: { state: RegistryFormState }) {
  if (state.ok || !state.error || state.field) return null;
  return (
    <p className={s.fieldError} role="alert">
      {state.error}
    </p>
  );
}

// ── conta ────────────────────────────────────────────────────────────────────

function AccountForm({
  conta,
  titulares,
  coresUsadas,
  onDone,
}: {
  conta?: AccountRow;
  titulares: string[];
  coresUsadas: string[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveAccountAction, INICIAL);
  const uid = useId();
  const listaTitulares = `${uid}-titulares`;

  // Em efeito, e nao no corpo do render: fechar o formulario altera estado do
  // COMPONENTE PAI, e fazer isso durante o render de um filho e' exatamente o
  // que o React proibe — avisa no console e pode entrar em laco.
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className={s.form}>
      {conta ? <input type="hidden" name="id" value={conta.id} /> : null}

      <div className={s.grid}>
        <label className={s.field}>
          <span className={s.label}>Nome</span>
          <input
            name="name"
            className={s.input}
            defaultValue={conta?.name ?? ""}
            placeholder="Sicoob"
            maxLength={40}
            required
          />
          <Erro state={state} campo="name" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Tipo</span>
          <select name="type" className={s.input} defaultValue={conta?.type ?? "checking"}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABEL[t as AccountType]}
              </option>
            ))}
          </select>
          <Erro state={state} campo="type" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Titular</span>
          <input
            name="holder"
            className={s.input}
            defaultValue={conta?.holder ?? ""}
            placeholder="Edu"
            list={listaTitulares}
            maxLength={30}
          />
          <datalist id={listaTitulares}>
            {titulares.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <span className={s.hint}>Quem recebe nesta conta. Em branco = conjunta.</span>
          <Erro state={state} campo="holder" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Etiqueta</span>
          <input
            name="tag"
            className={s.input}
            defaultValue={conta?.tag ?? ""}
            placeholder="Pix + débito"
            maxLength={30}
          />
          <Erro state={state} campo="tag" />
        </label>

        {/*
          Não há saldo inicial. No envelope mensal a conta é rótulo de onde o
          dinheiro entrou, não um pote com saldo próprio — o dinheiro que já
          existia entra como receita do primeiro mês.
        */}
        <label className={s.field}>
          <span className={s.label}>Iniciais</span>
          <input
            name="initials"
            className={s.input}
            defaultValue={conta?.initials ?? ""}
            placeholder="derivado do nome"
            maxLength={3}
          />
          <Erro state={state} campo="initials" />
        </label>

        <div className={s.field}>
          <span className={s.label}>Cor</span>
          <ColorPicker name="color" atual={conta?.color ?? corPadrao(coresUsadas)} />
          <Erro state={state} campo="color" />
        </div>
      </div>

      <label className={s.check}>
        <input
          type="checkbox"
          name="includeInCashTotal"
          defaultChecked={conta ? conta.includeInCashTotal : true}
        />
        <span>
          Somar no dinheiro em caixa
          <span className={s.hint}> — desmarque para corretora, que não é saldo disponível</span>
        </span>
      </label>

      <ErroGeral state={state} />

      <div className={s.actions}>
        <button type="submit" className={s.primary} disabled={pending}>
          {pending ? "Salvando…" : conta ? "Salvar conta" : "Criar conta"}
        </button>
        <button type="button" className={s.ghost} onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ── cartao ───────────────────────────────────────────────────────────────────

function CardForm({
  cartao,
  titulares,
  coresUsadas,
  onDone,
}: {
  cartao?: CardRow;
  titulares: string[];
  coresUsadas: string[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveCardAction, INICIAL);
  const uid = useId();
  const listaTitulares = `${uid}-titulares-cartao`;

  // Previa do prazo. Fechamento e vencimento trocados dao um numero absurdo, e
  // ver isso na hora evita meses de fatura no lugar errado.
  const [fechamento, setFechamento] = useState(cartao?.closingDay ?? 1);
  const [vencimento, setVencimento] = useState(cartao?.dueDay ?? 10);
  const prazo = daysOfFloat(fechamento, vencimento);

  // Ver o comentario equivalente em `AccountForm`.
  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className={s.form}>
      {cartao ? <input type="hidden" name="id" value={cartao.id} /> : null}

      <div className={s.grid}>
        <label className={s.field}>
          <span className={s.label}>Nome</span>
          <input
            name="name"
            className={s.input}
            defaultValue={cartao?.name ?? ""}
            placeholder="Nubank Edu"
            maxLength={40}
            required
          />
          <Erro state={state} campo="name" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Bandeira</span>
          <input
            name="brand"
            className={s.input}
            defaultValue={cartao?.brand ?? ""}
            placeholder="Mastercard"
            maxLength={40}
            required
          />
          <Erro state={state} campo="brand" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Titular</span>
          <input
            name="holder"
            className={s.input}
            defaultValue={cartao?.holder ?? ""}
            placeholder="Edu"
            list={listaTitulares}
            maxLength={30}
          />
          <datalist id={listaTitulares}>
            {titulares.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <Erro state={state} campo="holder" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Final</span>
          <input
            name="lastFour"
            className={s.input}
            defaultValue={cartao?.lastFour ?? ""}
            placeholder="1234"
            inputMode="numeric"
            maxLength={4}
          />
          <Erro state={state} campo="lastFour" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Dia de fechamento</span>
          <input
            name="closingDay"
            className={s.input}
            type="number"
            min={1}
            max={31}
            defaultValue={cartao?.closingDay ?? 1}
            onChange={(e) => setFechamento(Number(e.target.value))}
            required
          />
          <span className={s.hint}>Depois desse dia, a compra cai na fatura seguinte.</span>
          <Erro state={state} campo="closingDay" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Dia de vencimento</span>
          <input
            name="dueDay"
            className={s.input}
            type="number"
            min={1}
            max={31}
            defaultValue={cartao?.dueDay ?? 10}
            onChange={(e) => setVencimento(Number(e.target.value))}
            required
          />
          <Erro state={state} campo="dueDay" />
        </label>

        <label className={s.field}>
          <span className={s.label}>Limite</span>
          <MoneyInput name="limit" className={s.input} defaultCents={cartao?.limitCents} />
          <Erro state={state} campo="limit" />
        </label>

        {/*
          Não há "paga desta conta". O dinheiro é um só: a conta registra onde
          ele entrou, não de qual pote a fatura sai.
        */}
        <div className={s.field}>
          <span className={s.label}>Cor</span>
          <ColorPicker name="color" atual={cartao?.color ?? corPadrao(coresUsadas)} />
          <Erro state={state} campo="color" />
        </div>
      </div>

      <p className={s.float}>
        Comprando logo depois do fechamento, você paga em <strong>{prazo} dias</strong>.
        {prazo < 25 ? " Prazo curto — confira se não trocou fechamento por vencimento." : null}
      </p>

      <ErroGeral state={state} />

      <div className={s.actions}>
        <button type="submit" className={s.primary} disabled={pending}>
          {pending ? "Salvando…" : cartao ? "Salvar cartão" : "Criar cartão"}
        </button>
        <button type="button" className={s.ghost} onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

// ── listas ───────────────────────────────────────────────────────────────────

// ── categoria ────────────────────────────────────────────────────────────────

function CategoryForm({
  categoria,
  tipoInicial,
  coresUsadas,
  onDone,
}: {
  categoria?: CategoryRow;
  tipoInicial: CategoryKind;
  coresUsadas: string[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveCategoryAction, INICIAL);
  const [kind, setKind] = useState<CategoryKind>(categoria?.kind ?? tipoInicial);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  return (
    <form action={formAction} className={s.form}>
      {categoria ? <input type="hidden" name="id" value={categoria.id} /> : null}

      <div className={s.grid}>
        <label className={s.field}>
          <span className={s.label}>Nome</span>
          <input
            name="name"
            className={s.input}
            defaultValue={categoria?.name ?? ""}
            placeholder={kind === "income" ? "Salário Edu" : "Alimentação"}
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
            onChange={(e) => setKind(e.target.value as CategoryKind)}
          >
            {CATEGORY_KINDS.map((k) => (
              <option key={k} value={k}>
                {CATEGORY_KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <Erro state={state} campo="kind" />
        </label>

        {/* Orçamento só faz sentido em gasto: orçar receita não quer dizer nada. */}
        {kind === "expense" ? (
          <label className={s.field}>
            <span className={s.label}>Orçamento mensal</span>
            <MoneyInput
              name="budget"
              className={s.input}
              defaultCents={categoria?.monthlyBudgetCents}
              placeholder="opcional"
            />
            <span className={s.hint}>Em branco = sem teto.</span>
            <Erro state={state} campo="budget" />
          </label>
        ) : null}

        <div className={s.field}>
          <span className={s.label}>Cor</span>
          <ColorPicker name="color" atual={categoria?.color ?? corPadrao(coresUsadas)} />
          <Erro state={state} campo="color" />
        </div>
      </div>

      <ErroGeral state={state} />

      <div className={s.actions}>
        <button type="submit" className={s.primary} disabled={pending}>
          {pending ? "Salvando…" : categoria ? "Salvar categoria" : "Criar categoria"}
        </button>
        <button type="button" className={s.ghost} onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

/** Lista, em portugues legivel, o que a exclusao leva junto. */
function consequencias(i: Impacto | undefined): string[] {
  if (!i) return [];
  const plural = (n: number, um: string, muitos: string) => `${n} ${n === 1 ? um : muitos}`;
  const linhas: string[] = [];
  if (i.lancamentos > 0) linhas.push(plural(i.lancamentos, "lançamento", "lançamentos"));
  if (i.regras > 0) linhas.push(plural(i.regras, "regra recorrente", "regras recorrentes"));
  if (i.faturas > 0) linhas.push(plural(i.faturas, "fatura", "faturas"));
  return linhas;
}

/**
 * Confirmacao que mostra o ESTRAGO, nao um "tem certeza?".
 *
 * A exclusao e' definitiva e cascateia: apagar uma conta com meses de historico
 * nao e' "parei de usar", e' "este dinheiro nunca existiu" — totais de meses
 * fechados mudam retroativamente. Um dialogo generico esconde exatamente isso;
 * o numero de lancamentos que vao junto, nao.
 */
function Excluir({
  id,
  nome,
  impacto,
  action,
}: {
  id: string;
  nome: string;
  impacto: Impacto | undefined;
  action: (formData: FormData) => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const perdas = consequencias(impacto);

  if (!confirmando) {
    return (
      <button type="button" className={s.ghost} onClick={() => setConfirmando(true)}>
        Excluir
      </button>
    );
  }

  return (
    <div className={perdas.length > 0 ? `${s.confirm} ${s.confirmHeavy}` : s.confirm} role="alert">
      <div className={s.confirmText}>
        <strong>Apagar “{nome}”?</strong>{" "}
        {perdas.length > 0 ? (
          <>
            Isso apaga junto, <strong>sem volta</strong>: {perdas.join(", ")}.
          </>
        ) : (
          "Nada depende dele — nenhum lançamento será afetado."
        )}
      </div>
      <div className={s.actions}>
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className={s.danger}>
            Apagar definitivamente
          </button>
        </form>
        <button type="button" className={s.ghost} onClick={() => setConfirmando(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function Registry({
  contas,
  cartoes,
  categorias,
  regras,
  titulares,
  mesCorrente,
  impactosContas,
  impactosCartoes,
  impactosCategorias,
  impactosRegras,
}: {
  contas: AccountRow[];
  cartoes: CardRow[];
  titulares: string[];
  categorias: CategoryRow[];
  regras: RecurringRow[];
  /** Padrao do campo "começou em" ao criar uma regra. */
  mesCorrente: string;
  /** id -> quantos dependentes. Alimenta a confirmacao de exclusao. */
  impactosContas: Record<string, Impacto>;
  impactosCartoes: Record<string, Impacto>;
  impactosCategorias: Record<string, Impacto>;
  impactosRegras: Record<string, Impacto>;
}) {
  const [editandoConta, setEditandoConta] = useState<string | null>(null);
  const [editandoCartao, setEditandoCartao] = useState<string | null>(null);
  const [editandoCategoria, setEditandoCategoria] = useState<string | null>(null);
  const [editandoRegra, setEditandoRegra] = useState<string | null>(null);

  const coresContas = contas.map((c) => c.color);
  const coresCartoes = cartoes.map((c) => c.color);
  const coresCategorias = categorias.map((c) => c.color);

  return (
    <div className={s.wrap}>
      <section className={s.section}>
        <header className={s.sectionHead}>
          <div>
            <h2 className={s.sectionTitle}>Contas</h2>
            <p className={s.sectionSub}>
              Onde o dinheiro fica. Receita e aporte <strong>exigem</strong> uma conta — sem nenhuma
              cadastrada, não dá para lançar salário.
            </p>
          </div>
          <button
            type="button"
            className={s.primary}
            onClick={() => setEditandoConta(editandoConta === "nova" ? null : "nova")}
          >
            Nova conta
          </button>
        </header>

        {editandoConta === "nova" ? (
          <AccountForm
            titulares={titulares}
            coresUsadas={coresContas}
            onDone={() => setEditandoConta(null)}
          />
        ) : null}

        {contas.length === 0 ? (
          <p className={s.empty}>Nenhuma conta ainda.</p>
        ) : (
          <ul className={s.list}>
            {contas.map((c) => (
              <li key={c.id} className={s.row}>
                {editandoConta === c.id ? (
                  <AccountForm
                    conta={c}
                    titulares={titulares}
                    coresUsadas={coresContas.filter((x) => x !== c.color)}
                    onDone={() => setEditandoConta(null)}
                  />
                ) : (
                  <div className={s.rowLine}>
                    <span className={s.badge} style={{ background: c.color }}>
                      {c.initials}
                    </span>
                    <div className={s.rowMain}>
                      <span className={s.rowName}>
                        {c.name}
                        {c.holder ? <span className={s.holder}>{c.holder}</span> : null}
                      </span>
                      <span className={s.rowSub}>
                        {ACCOUNT_TYPE_LABEL[c.type as AccountType]}
                        {c.tag ? ` · ${c.tag}` : ""}
                        {c.includeInCashTotal ? "" : " · fora do caixa"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={s.ghost}
                      onClick={() => setEditandoConta(c.id)}
                    >
                      Editar
                    </button>
                    <Excluir
                      id={c.id}
                      nome={c.name}
                      impacto={impactosContas[c.id]}
                      action={deleteAccountAction}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.section}>
        <header className={s.sectionHead}>
          <div>
            <h2 className={s.sectionTitle}>Cartões</h2>
            <p className={s.sectionSub}>
              O <strong>dia de fechamento</strong> é o que faz o app saber sozinho em que fatura cai
              cada compra — é o trabalho que a planilha deixava para você.
            </p>
          </div>
          <button
            type="button"
            className={s.primary}
            onClick={() => setEditandoCartao(editandoCartao === "novo" ? null : "novo")}
          >
            Novo cartão
          </button>
        </header>

        {editandoCartao === "novo" ? (
          <CardForm
            titulares={titulares}
            coresUsadas={coresCartoes}
            onDone={() => setEditandoCartao(null)}
          />
        ) : null}

        {cartoes.length === 0 ? (
          <p className={s.empty}>Nenhum cartão ainda.</p>
        ) : (
          <ul className={s.list}>
            {cartoes.map((c) => (
              <li key={c.id} className={s.row}>
                {editandoCartao === c.id ? (
                  <CardForm
                    cartao={c}
                    titulares={titulares}
                    coresUsadas={coresCartoes.filter((x) => x !== c.color)}
                    onDone={() => setEditandoCartao(null)}
                  />
                ) : (
                  <div className={s.rowLine}>
                    <span className={s.dot} style={{ background: c.color }} />
                    <div className={s.rowMain}>
                      <span className={s.rowName}>
                        {c.name}
                        {c.holder ? <span className={s.holder}>{c.holder}</span> : null}
                      </span>
                      <span className={s.rowSub}>
                        {c.brand}
                        {c.lastFour ? ` · final ${c.lastFour}` : ""} · fecha dia {c.closingDay} ·
                        vence dia {c.dueDay}
                      </span>
                    </div>
                    <span className={s.rowValue}>{brl(cents(c.limitCents))}</span>
                    <button
                      type="button"
                      className={s.ghost}
                      onClick={() => setEditandoCartao(c.id)}
                    >
                      Editar
                    </button>
                    <Excluir
                      id={c.id}
                      nome={c.name}
                      impacto={impactosCartoes[c.id]}
                      action={deleteCardAction}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.section}>
        <header className={s.sectionHead}>
          <div>
            <h2 className={s.sectionTitle}>Categorias</h2>
            <p className={s.sectionSub}>
              Todo lançamento precisa de uma. <strong>Gasto</strong> agrupa o gráfico de despesas;{" "}
              <strong>receita</strong> separa de onde o dinheiro vem — "Salário Edu", "Salário
              Nessa".
            </p>
          </div>
          <button
            type="button"
            className={s.primary}
            onClick={() => setEditandoCategoria(editandoCategoria === "nova" ? null : "nova")}
          >
            Nova categoria
          </button>
        </header>

        {editandoCategoria === "nova" ? (
          <CategoryForm
            tipoInicial="expense"
            coresUsadas={coresCategorias}
            onDone={() => setEditandoCategoria(null)}
          />
        ) : null}

        {categorias.length === 0 ? (
          <p className={s.empty}>Nenhuma categoria ainda — sem elas não dá para lançar nada.</p>
        ) : (
          <ul className={s.list}>
            {categorias.map((c) => (
              <li key={c.id} className={s.row}>
                {editandoCategoria === c.id ? (
                  <CategoryForm
                    categoria={c}
                    tipoInicial={c.kind}
                    coresUsadas={coresCategorias.filter((x) => x !== c.color)}
                    onDone={() => setEditandoCategoria(null)}
                  />
                ) : (
                  <div className={s.rowLine}>
                    <span className={s.dot} style={{ background: c.color }} />
                    <div className={s.rowMain}>
                      <span className={s.rowName}>
                        {c.name}
                        <span className={s.holder}>{CATEGORY_KIND_LABEL[c.kind]}</span>
                        {c.isSystem ? <span className={s.holder}>sistema</span> : null}
                      </span>
                      <span className={s.rowSub}>
                        {c.monthlyBudgetCents != null
                          ? `orçamento ${brl(cents(c.monthlyBudgetCents))}`
                          : "sem orçamento"}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={s.ghost}
                      onClick={() => setEditandoCategoria(c.id)}
                    >
                      Editar
                    </button>
                    {/*
                      Categoria de sistema não oferece exclusão: o app depende
                      dela para classificar receita e aporte, e apagá-la deixaria
                      ações inteiras sem destino possível.
                    */}
                    {c.isSystem ? null : (
                      <Excluir
                        id={c.id}
                        nome={c.name}
                        impacto={impactosCategorias[c.id]}
                        action={deleteCategoryAction}
                      />
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={s.section}>
        <header className={s.sectionHead}>
          <div>
            <h2 className={s.sectionTitle}>Contas fixas e assinaturas</h2>
            <p className={s.sectionSub}>
              O que se repete todo mês. Marcar como <strong>obrigatória</strong> soma no custo de
              vida — é a base da reserva de emergência.
            </p>
          </div>
          <button
            type="button"
            className={s.primary}
            onClick={() => setEditandoRegra(editandoRegra === "nova" ? null : "nova")}
          >
            Nova conta fixa
          </button>
        </header>

        {editandoRegra === "nova" ? (
          <RecurringForm
            categorias={categorias}
            contas={contas}
            cartoes={cartoes}
            mesCorrente={mesCorrente}
            onDone={() => setEditandoRegra(null)}
          />
        ) : null}

        {regras.length === 0 ? (
          <p className={s.empty}>Nenhuma conta fixa ainda.</p>
        ) : (
          <ul className={s.list}>
            {regras.map((r) => (
              <li key={r.id} className={s.row}>
                {editandoRegra === r.id ? (
                  <RecurringForm
                    regra={r}
                    categorias={categorias}
                    contas={contas}
                    cartoes={cartoes}
                    mesCorrente={mesCorrente}
                    onDone={() => setEditandoRegra(null)}
                  />
                ) : (
                  <div className={s.rowLine}>
                    <div className={s.rowMain}>
                      <span className={s.rowName}>
                        {r.name}
                        {r.essential ? <span className={s.holder}>obrigatória</span> : null}
                        {r.installmentsTotal ? (
                          <span className={s.holder}>{r.installmentsTotal}x</span>
                        ) : null}
                      </span>
                      <span className={s.rowSub}>
                        dia {r.dueDay} · {r.kind === "subscription" ? "no cartão" : "em conta"}
                        {r.isVariable ? " · valor variável" : ""}
                                              </span>
                    </div>
                    <span className={s.rowValue}>
                      {brl(cents(r.isVariable ? (r.estimatedCents ?? 0) : (r.amountCents ?? 0)))}
                    </span>
                    <button
                      type="button"
                      className={s.ghost}
                      onClick={() => setEditandoRegra(r.id)}
                    >
                      Editar
                    </button>
                    <Excluir
                      id={r.id}
                      nome={r.name}
                      impacto={impactosRegras[r.id]}
                      action={deleteRecurringAction}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
