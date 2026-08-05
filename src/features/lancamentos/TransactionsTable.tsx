import { Money } from "@/components/ui/Money";
import { Card, CategoryDot, EmptyState, SectionHeader } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/StatusPill";
import { type FlowKind, subCents } from "@/domain/money";
import { shortDate } from "@/domain/period";
import type { EntryFormOptions } from "@/services/entry-form";
import { methodLabel, type TransactionsResult } from "@/services/queries";
import { EditEntryModal } from "./EditEntryModal.client";
import { EntryActions } from "./EntryActions.client";
import { FilterChips } from "./filters.client";
import s from "./Transactions.module.css";

const KIND_OPTIONS = [
  ["todos", "Todos"],
  ["receita", "Receitas"],
  ["despesa", "Despesas"],
  ["aporte", "Aportes"],
] as const;

const METHOD_OPTIONS = [
  ["todos", "Todo meio"],
  ["pix", "Pix"],
  ["debit", "Débito"],
  ["credit", "Crédito"],
  ["boleto", "Boleto"],
] as const;

/** Traduz o tipo do banco para o formato de sinal do design. */
function flowKindOf(kind: string): FlowKind {
  if (kind === "income") return "receita";
  if (kind === "investment_out" || kind === "investment_in") return "aporte";
  return "despesa";
}

export function TransactionsTable({
  data,
  kindFilter,
  methodFilter,
  editando,
  formOptions,
}: {
  data: TransactionsResult;
  kindFilter: string;
  methodFilter: string;
  /** Id vindo de `?editar=` — a linha que abre no modal. */
  editando?: string;
  formOptions: EntryFormOptions;
}) {
  // A linha vem da lista que ja' esta' em maos: abrir o modal nao deve custar
  // outra ida ao banco.
  const emEdicao = editando ? data.rows.find((t) => t.id === editando) : undefined;

  return (
    <Card>
      <SectionHeader
        title="Lançamentos do mês"
        sub={`${data.shown} lançamentos · entradas e saídas com categoria, meio e parcelas`}
        right={
          <span className={s.summary}>
            entradas <Money cents={data.incomeCents} size="xs" tone="pos" /> · saídas{" "}
            <Money cents={data.outflowCents} size="xs" tone="neg" />
          </span>
        }
      />

      <div className={s.toolbar} style={{ marginBottom: 16 }}>
        <FilterChips
          param="tipo"
          options={KIND_OPTIONS}
          current={kindFilter}
          label="Filtrar por tipo"
        />
        <FilterChips
          param="meio"
          options={METHOD_OPTIONS}
          current={methodFilter}
          label="Filtrar por meio de pagamento"
        />
      </div>

      {data.rows.length === 0 ? (
        <EmptyState>
          Nenhum lançamento com esses filtros.
          {data.total > 0 ? ` Há ${data.total} no mês.` : ""}
        </EmptyState>
      ) : (
        <>
          <table className={s.table}>
            <caption className="sr-only" style={{ position: "absolute", left: -9999 }}>
              Lançamentos do mês, com data, descrição, categoria, meio de pagamento, conta, parcela,
              situação e valor
            </caption>
            <thead>
              <tr>
                <th scope="col" className={s.th} style={{ width: 62 }}>
                  Data
                </th>
                <th scope="col" className={s.th}>
                  Descrição
                </th>
                <th scope="col" className={s.th} style={{ width: 150 }}>
                  Categoria
                </th>
                <th scope="col" className={s.th} style={{ width: 96 }}>
                  Meio
                </th>
                <th scope="col" className={s.th} style={{ width: 150 }}>
                  Conta
                </th>
                <th scope="col" className={s.th} style={{ width: 62 }}>
                  Parc.
                </th>
                <th scope="col" className={s.th} style={{ width: 96 }}>
                  Situação
                </th>
                <th scope="col" className={`${s.th} ${s.thRight}`} style={{ width: 118 }}>
                  Valor
                </th>
                <th scope="col" className={`${s.th} ${s.thRight}`} style={{ width: 132 }}>
                  <span className={s.srOnly}>Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={t.id} className={s.row}>
                  <td className={`${s.td} ${s.date}`}>{shortDate(t.occurredOn)}</td>
                  <td className={`${s.td} ${s.desc}`}>{t.description}</td>
                  <td className={s.td}>
                    <span className={s.cat}>
                      {t.categoryColor ? <CategoryDot color={t.categoryColor} size={8} /> : null}
                      {t.categoryName ?? "—"}
                    </span>
                  </td>
                  <td className={`${s.td} ${s.muted}`}>{methodLabel(t.method)}</td>
                  <td className={`${s.td} ${s.muted}`}>{t.sourceName}</td>
                  <td className={`${s.td} ${s.mono}`}>{t.installmentLabel ?? "—"}</td>
                  <td className={s.td}>
                    <StatusPill tone={t.tone}>{t.status}</StatusPill>
                  </td>
                  <td className={`${s.td} ${s.tdRight}`}>
                    <Money
                      cents={t.amountCents}
                      kind={flowKindOf(t.kind)}
                      size="sm"
                      tone={t.kind === "income" ? "pos" : "default"}
                    />
                  </td>
                  <td className={`${s.td} ${s.tdRight}`}>
                    <EntryActions id={t.id} description={t.description} link={t.link} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className={s.foot}>
            <span>
              {data.shown} de {data.total} exibidos
            </span>
            <span>
              saldo do filtro:{" "}
              <Money
                cents={subCents(data.incomeCents, data.outflowCents)}
                size="xs"
                tone={data.incomeCents >= data.outflowCents ? "pos" : "neg"}
              />
            </span>
          </div>
        </>
      )}

      {emEdicao ? (
        // `key` no id: trocar de linha sem remontar deixaria os campos da
        // anterior preenchidos, porque o estado inicial so' e' lido uma vez.
        <EditEntryModal key={emEdicao.id} row={emEdicao} options={formOptions} />
      ) : null}
    </Card>
  );
}
