import type { CSSProperties } from "react";
import { StackedBar } from "@/components/ui/bars";
import { Money, Pct } from "@/components/ui/Money";
import {
  Card,
  CategoryDot,
  EmptyState,
  MicroLabel,
  Notice,
  SectionHeader,
} from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/StatusPill";
import { widthPercent } from "@/domain/math";
import { brl, type Cents, cents, compactK, maxCents } from "@/domain/money";
import { shortDate } from "@/domain/period";
import type { OverviewData } from "@/services/overview";
import type { AccountBalance, CategoriesResult, TransactionRow } from "@/services/queries";
import s from "./Overview.module.css";

const GROUP_COLOR: Record<string, string> = {
  Essencial: "var(--group-essential)",
  "Qualidade de vida": "var(--group-quality)",
  Desenvolvimento: "var(--group-growth)",
};

export function Overview({
  data,
  categories,
  latest,
  accounts,
  cashTotalCents,
}: {
  data: OverviewData;
  categories: CategoriesResult;
  latest: TransactionRow[];
  accounts: AccountBalance[];
  cashTotalCents: Cents;
}) {
  const maxFlow = Math.max(1, ...data.flow.map((m) => Math.max(m.incomeCents, m.expenseCents)));
  const perDay = cents(Math.round(Math.max(0, data.freeCents) / 30));

  return (
    <>
      <div className={s.kpis}>
        <Kpi label="Receitas do mês" value={data.incomeCents} tone="pos" note="salário e freelas" />
        <Kpi
          label="Despesas do mês"
          value={data.expenseCents}
          tone="neg"
          note={`${fmtPct(data.expenseCents, data.incomeCents)} da renda · ${data.categoryCount} categorias`}
        />
        <Kpi
          label="Livre para gastar"
          value={data.freeCents}
          tone="onAccent"
          hero
          note={`após contas e aporte · ${brl(perDay)}/dia`}
        />
        <Kpi
          label="Aporte do mês"
          value={data.contributionCents}
          tone="info"
          note={`${fmtPct(data.contributionCents, data.incomeCents)} da renda · saída de caixa`}
        />
      </div>

      <Notice>
        Rendimento da carteira ({brl(data.investmentReturnCents)} no mês, sendo{" "}
        {brl(data.dividendCents)} de proventos) é reinvestido e <strong>não</strong> entra no fluxo
        do mês. Do caixa sai apenas o aporte de {brl(data.contributionCents)} — resgates, quando
        houver, entram como receita.
      </Notice>

      <div className={s.grid}>
        <div className={s.col}>
          <Card>
            <SectionHeader
              title="Fluxo de caixa · 6 meses"
              right={
                <div className={s.legend}>
                  <Legend color="var(--pos-soft)" label="entradas" />
                  <Legend color="var(--neg-bar)" label="saídas" />
                  <Legend color="var(--info-bar)" label="aporte" />
                </div>
              }
            />
            <div
              className={s.chart}
              role="img"
              aria-label={`Fluxo de caixa dos últimos 6 meses. ${data.flow
                .map(
                  (m) => `${m.label}: entradas ${brl(m.incomeCents)}, saídas ${brl(m.expenseCents)}`
                )
                .join(". ")}`}
            >
              {data.flow.map((m) => (
                <div key={m.key} className={s.bars}>
                  <Bar cls={s.barIn} value={m.incomeCents} max={maxFlow} title="entradas" />
                  <Bar cls={s.barOut} value={m.expenseCents} max={maxFlow} title="saídas" />
                  <Bar cls={s.barInv} value={m.contributionCents} max={maxFlow} title="aporte" />
                </div>
              ))}
            </div>
            <div className={s.chartLabels}>
              {data.flow.map((m) => (
                <div key={m.key} className={s.chartLabel}>
                  <span className={s.chartMonth}>{m.label}</span>
                  <span className={s.chartBalance}>{compactK(m.balanceCents)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeader
              title="Gastos por grupo e categoria"
              right={
                <MicroLabel>{fmtPct(data.expenseCents, data.incomeCents)} da renda</MicroLabel>
              }
            />
            <div className={s.list}>
              {categories.groups.map((g) => (
                <div key={g.id} className={s.groupRow}>
                  <div className={s.groupHead}>
                    <span className={s.groupName}>{g.name}</span>
                    <span>
                      <Money cents={g.spentCents} size="sm" />{" "}
                      <Pct value={pctOf(g.spentCents, data.incomeCents)} tone="muted" />
                    </span>
                  </div>
                  <StackedBar
                    height={8}
                    label={`Composição de ${g.name}`}
                    segments={g.categories.map((c) => ({
                      id: c.id,
                      label: c.name,
                      value: c.spentCents,
                      color: c.color,
                    }))}
                  />
                  <div className={s.groupCats}>
                    {g.categories.slice(0, 4).map((c) => (
                      <span key={c.id} className={s.groupCat}>
                        <CategoryDot color={c.color} size={7} />
                        {c.name}
                        <Money cents={c.spentCents} size="xs" tone="muted" compact />
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeader title="Últimos lançamentos" />
            <div className={s.list}>
              {latest.length === 0 ? (
                <EmptyState>Nenhum lançamento neste mês.</EmptyState>
              ) : (
                latest.map((t) => (
                  <div key={t.id} className={s.listRow}>
                    <span className={s.listMain}>
                      {t.categoryColor ? <CategoryDot color={t.categoryColor} size={8} /> : null}
                      <span className={s.listName}>{t.description}</span>
                      <span className={s.listMeta}>{shortDate(t.occurredOn)}</span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <StatusPill tone={t.tone}>{t.status}</StatusPill>
                      <Money
                        cents={t.amountCents}
                        size="sm"
                        kind={t.kind === "income" ? "receita" : "despesa"}
                        tone={t.kind === "income" ? "pos" : "default"}
                      />
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className={s.col}>
          <Card>
            <SectionHeader
              title="Vence em 7 dias"
              right={<Money cents={data.due7TotalCents} size="sm" tone="muted" />}
            />
            <div className={s.list}>
              {data.due7.length === 0 ? (
                <EmptyState>Nada vence nos próximos 7 dias.</EmptyState>
              ) : (
                data.due7.map((d) => (
                  <div key={d.id} className={s.listRow}>
                    <span className={s.listMain}>
                      <span className={s.listName}>{d.name}</span>
                      <span className={s.listMeta}>
                        {shortDate(d.dueDate)} · {d.fixed ? "fixa" : "variável"} ·{" "}
                        {d.autopay ? "auto" : "manual"}
                      </span>
                    </span>
                    <Money cents={d.amountCents} size="sm" />
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card>
            <SectionHeader
              title="Para onde vai a renda"
              sub={`renda de ${brl(data.incomeCents)}`}
            />
            <StackedBar
              height={12}
              label="Distribuição da renda do mês"
              segments={[
                ...categories.groups.map((g) => ({
                  id: g.id,
                  label: g.name,
                  value: g.spentCents,
                  color: GROUP_COLOR[g.name] ?? "var(--fg-mut)",
                })),
                {
                  id: "aporte",
                  label: "Aporte em investimentos",
                  value: data.contributionCents,
                  color: "var(--info-bar)",
                },
                {
                  id: "livre",
                  label: "Sobra livre",
                  value: Math.max(0, data.freeCents),
                  color: "rgba(255,255,255,.20)",
                },
              ]}
            />
            <div style={{ marginTop: 12 }}>
              {[
                ...categories.groups.map((g) => ({
                  id: g.id,
                  name: g.name,
                  value: g.spentCents,
                  color: GROUP_COLOR[g.name] ?? "var(--fg-mut)",
                })),
                {
                  id: "aporte",
                  name: "Aporte em investimentos",
                  value: data.contributionCents,
                  color: "var(--info-bar)",
                },
                {
                  id: "livre",
                  name: "Sobra livre",
                  value: maxCents(cents(0), data.freeCents),
                  color: "rgba(255,255,255,.20)",
                },
              ].map((row) => (
                <div key={row.id} className={s.allocRow}>
                  <span className={s.allocLabel}>
                    <CategoryDot color={row.color} size={8} />
                    {row.name}
                  </span>
                  <span>
                    <Money cents={row.value as Cents} size="sm" />{" "}
                    <Pct value={pctOf(row.value, data.incomeCents)} tone="muted" />
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionHeader title="Saldos em conta" />
            <div className={s.list}>
              {accounts.map((a) => (
                <div key={a.id} className={s.account}>
                  <span className={s.listMain}>
                    <span
                      className={s.accountBadge}
                      style={{ "--badge-color": a.color } as CSSProperties}
                      aria-hidden="true"
                    >
                      {a.initials}
                    </span>
                    <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span className={s.listName}>{a.name}</span>
                      <span className={s.listMeta}>{a.tag ?? a.type}</span>
                    </span>
                  </span>
                  <Money cents={a.balanceCents} size="sm" />
                </div>
              ))}
            </div>
            <div className={s.total}>
              <MicroLabel>Total em caixa</MicroLabel>
              <Money cents={cashTotalCents} size="md" tone="pos" />
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function Kpi({
  label,
  value,
  note,
  tone,
  hero,
}: {
  label: string;
  value: Cents;
  note: string;
  tone: "pos" | "neg" | "info" | "onAccent";
  hero?: boolean;
}) {
  return (
    <div className={hero ? `${s.kpi} ${s.kpiHero}` : s.kpi}>
      <span className={s.kpiLabel}>
        <MicroLabel>{label}</MicroLabel>
      </span>
      <Money cents={value} size="xl" tone={tone} />
      <span className={s.kpiNote}>{note}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className={s.legendItem}>
      <i className={s.legendSwatch} style={{ "--swatch": color } as CSSProperties} />
      {label}
    </span>
  );
}

function Bar({
  cls,
  value,
  max,
  title,
}: {
  cls: string | undefined;
  value: number;
  max: number;
  title: string;
}) {
  return (
    <div
      className={`${s.bar} ${cls ?? ""}`}
      style={{ "--h": `${widthPercent(value, max).toFixed(1)}%` } as CSSProperties}
      title={title}
    />
  );
}

function pctOf(value: number, total: number): number {
  return widthPercent(value, total);
}

function fmtPct(value: number, total: number): string {
  return `${pctOf(value, total).toFixed(1).replace(".", ",")}%`;
}
