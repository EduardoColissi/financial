import type { CSSProperties } from "react";
import { ProgressBar } from "@/components/ui/bars";
import { Money, Pct } from "@/components/ui/Money";
import {
  Card,
  CategoryDot,
  EmptyState,
  MicroLabel,
  SectionHeader,
} from "@/components/ui/primitives";
import { widthPercent } from "@/domain/math";
import { brl, brl0, type Cents, subCents } from "@/domain/money";
import { cx } from "@/lib/cx";
import type { CategoriesResult, CategoryStat } from "@/services/queries";
import s from "./Categories.module.css";

/**
 * Monta o `conic-gradient` do donut.
 *
 * O design constroi a string dividindo direto por `despesas` (linha 1395). Num
 * mes sem despesa isso produz `NaN%`, o que invalida a regra CSS inteira e faz
 * o grafico DESAPARECER — nao degradar, sumir. Aqui o total zero e' tratado
 * antes de qualquer divisao.
 */
function donutGradient(items: readonly CategoryStat[], total: number): string | null {
  if (total <= 0 || items.length === 0) return null;

  let acc = 0;
  const stops = items.map((c) => {
    const from = acc;
    const to = acc + widthPercent(c.spentCents, total);
    acc = to;
    return `${c.color} ${from.toFixed(2)}% ${to.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(",")})`;
}

export function Categories({ data, incomeCents }: { data: CategoriesResult; incomeCents: Cents }) {
  const donut = donutGradient(data.categories, data.totalCents);
  const withBudget = data.categories.filter((c) => c.budgetCents != null && c.budgetCents > 0);

  return (
    <div className={s.layout}>
      <div className={s.col}>
        <Card>
          <SectionHeader
            title="Onde o dinheiro foi"
            sub={`${data.transactionCount} lançamentos classificados em ${data.categories.length} categorias`}
            right={<MicroLabel>{fmt(data.totalCents, incomeCents)} da renda</MicroLabel>}
          />
          {/*
            Lista plana, da maior para a menor. A barra compara com o TOTAL de
            saídas do mês — antes comparava com o total do grupo, que fazia a
            maior categoria de um grupo pequeno parecer tão pesada quanto a de
            um grupo grande.
          */}
          <div>
            {data.categories.length === 0 ? (
              <EmptyState>Nenhuma despesa classificada neste mês.</EmptyState>
            ) : (
              data.categories.map((c) => (
                <div key={c.id}>
                  <div className={s.catRow}>
                    <span className={s.catName}>
                      <CategoryDot color={c.color} size={8} />
                      <span className={s.catLabel}>{c.name}</span>
                    </span>
                    <span className={s.mono}>
                      {c.count} lanç. · {c.dominantMethod ?? "—"}
                    </span>
                    <span className={s.mono}>média {brl0(c.avgCents)}</span>
                    <span style={{ textAlign: "right" }}>
                      <Money cents={c.spentCents} size="sm" />
                    </span>
                  </div>
                  <div className={s.bar}>
                    <ProgressBar
                      value={c.spentCents}
                      total={data.totalCents}
                      color={c.color}
                      height={5}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card>
          <SectionHeader
            title="Orçado × realizado"
            sub="orçamento mensal por categoria — vermelho passou do previsto"
          />
          {withBudget.length === 0 ? (
            <EmptyState>Nenhuma categoria tem orçamento definido.</EmptyState>
          ) : (
            withBudget.map((c) => {
              const budget = c.budgetCents as Cents;
              const over = c.spentCents > budget;
              const diff = subCents(budget, c.spentCents);
              return (
                <div key={c.id} className={s.budgetRow}>
                  <div>
                    <div className={s.budgetHead}>
                      <span className={s.catName}>
                        <CategoryDot color={c.color} size={8} />
                        <span className={s.catLabel}>{c.name}</span>
                      </span>
                      <span className={s.mono}>
                        {brl(c.spentCents)} de {brl(budget)}
                      </span>
                    </div>
                    <ProgressBar
                      value={c.spentCents}
                      total={budget}
                      color={over ? "var(--neg-bar)" : c.color}
                      height={7}
                      label={`Orçamento de ${c.name}`}
                    />
                  </div>
                  <span className={cx(s.budgetStatus, over ? s.over : s.under)}>
                    {over ? "passou " : "sobram "}
                    {brl0(over ? subCents(c.spentCents, budget) : diff)}
                  </span>
                </div>
              );
            })
          )}
        </Card>
      </div>

      <div className={s.col}>
        <Card>
          <SectionHeader title="Composição das saídas" />
          {donut == null ? (
            <EmptyState>Nenhuma despesa neste mês.</EmptyState>
          ) : (
            <div className={s.donutWrap}>
              <div
                className={s.donut}
                style={{ "--donut": donut } as CSSProperties}
                role="img"
                aria-label={`Composição das saídas: ${data.categories
                  .slice(0, 5)
                  .map((c) => `${c.name} ${c.shareOfTotal.toFixed(0)}%`)
                  .join(", ")}`}
              >
                <div className={s.donutHole}>
                  <span>
                    <span className={s.donutTotal}>{brl0(data.totalCents)}</span>
                    <br />
                    <span className={s.donutLabel}>{data.categories.length} categorias</span>
                  </span>
                </div>
              </div>
              <div className={s.donutLegend}>
                {data.categories.slice(0, 7).map((c) => (
                  <span key={c.id} className={s.legendRow}>
                    <span className={s.legendName}>
                      <CategoryDot color={c.color} size={8} />
                      <span className={s.catLabel}>{c.name}</span>
                    </span>
                    <Pct value={c.shareOfTotal} tone="muted" />
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader title="Todas as categorias" />
          {data.categories.map((c) => (
            <div key={c.id} style={{ padding: "8px 0" }}>
              <div className={s.budgetHead}>
                <span className={s.catName}>
                  <CategoryDot color={c.color} size={8} />
                  <span className={s.catLabel}>{c.name}</span>
                </span>
                <span>
                  <Money cents={c.spentCents} size="sm" />{" "}
                  <Pct value={c.shareOfTotal} tone="muted" />
                </span>
              </div>
              <ProgressBar
                value={c.spentCents}
                total={data.categories[0]?.spentCents ?? 1}
                color={c.color}
                height={5}
              />
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}

function fmt(value: number, total: number): string {
  return `${widthPercent(value, total).toFixed(1).replace(".", ",")}%`;
}
