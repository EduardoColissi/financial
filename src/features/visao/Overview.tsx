import type { CSSProperties } from "react";
import { StackedBar } from "@/components/ui/bars";
import { Money, Pct } from "@/components/ui/Money";
import {
  Card,
  CategoryDot,
  EmptyState,
  MicroLabel,
  SectionHeader,
} from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/StatusPill";
import { widthPercent } from "@/domain/math";
import { brl, type Cents, cents, compactK, maxCents } from "@/domain/money";
import { shortDate } from "@/domain/period";
import type { CashView } from "@/services/cash";
import type { OverviewData } from "@/services/overview";
import type { CategoriesResult, TransactionRow } from "@/services/queries";
import s from "./Overview.module.css";

export function Overview({
  data,
  categories,
  latest,
  cash,
}: {
  data: OverviewData;
  categories: CategoriesResult;
  latest: TransactionRow[];
  cash: CashView;
}) {
  const maxFlow = Math.max(1, ...data.flow.map((m) => Math.max(m.incomeCents, m.expenseCents)));

  return (
    <>
      {/*
        Os dois números do meio são o par que o dono pediu, e a diferença entre
        eles é o ponto: EM CONTA é o dinheiro que existe agora; SOBRA é o que
        vai restar depois de pagar tudo que este mês ainda deve. Convergem
        quando não há mais nada pendente — e a nota abaixo diz quanto falta.
      */}
      <div className={s.kpis}>
        <Kpi label="Receitas do mês" value={data.incomeCents} tone="pos" note="entradas do mês" />
        {/*
          O mês abre do zero. Se há algo aqui vindo do mês anterior, é porque
          sobrou e não foi aportado — e a nota diz isso, em vez de deixar o
          número parecer saldo bancário.
        */}
        <Kpi
          label="Em conta"
          testId="em-conta"
          value={cash.cashCents}
          tone="info"
          note={
            cash.carriedCents !== 0
              ? `${brl(cash.carriedCents)} sobraram do mês passado`
              : cash.settled
                ? "tudo pago — nada a descontar"
                : `ainda não descontou ${brl(cash.pendingCents)} a pagar`
          }
        />
        <Kpi
          label="Sobra"
          testId="sobra"
          value={cash.leftoverCents}
          tone="onAccent"
          hero
          note={
            cash.settled
              ? "mês fechado — igual ao que há em conta"
              : "já descontando tudo que falta pagar"
          }
        />
        <Kpi
          label="Despesas do mês"
          value={data.expenseCents}
          tone="neg"
          note={`${fmtPct(data.expenseCents, data.incomeCents)} da renda · ${data.categoryCount} categorias`}
        />
      </div>

      {/*
        O mês passado fechou com sobra e ninguém aportou. Aportar tira do caixa,
        então esse dinheiro está parado — e é justamente o que o dono pediu para
        o painel cutucar na virada do mês.
      */}
      {cash.previousUninvestedCents > 0 ? (
        <div className={`${s.health} ${s.carryNotice}`}>
          <HealthItem
            label="Sobrou do mês passado e não foi investido"
            value={brl(cash.previousUninvestedCents)}
            note="veio para este mês em vez de virar aporte"
            alerta
          />
        </div>
      ) : null}

      {/*
        Três medidas de saúde que não cabem nos KPIs: o custo de existir, a meta
        de reserva que ele define, e há quanto tempo o painel não recebe um
        lançamento — que é o que denuncia número bonito em cima de dado velho.
      */}
      <div className={s.health}>
        <HealthItem
          label="Custo de vida"
          value={brl(cash.costOfLivingCents)}
          note="média das contas obrigatórias"
        />
        <HealthItem
          label="Reserva de emergência"
          value={brl(cash.emergencyTargetCents)}
          note="6× o custo de vida"
        />
        <HealthItem
          label="Último lançamento"
          value={desdeQuando(data.lastEntryAt)}
          note={data.lastEntryAt ? quandoExato(data.lastEntryAt) : "nada lançado ainda"}
          alerta={precisaLancar(data.lastEntryAt)}
        />
      </div>

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

          {/*
            Era "por grupo e categoria", com Essencial / Qualidade de vida /
            Desenvolvimento por cima. O nivel de grupo saiu: o agrupamento que
            interessa e' este — todas as despesas do mes, separadas por
            categoria, da maior para a menor.
          */}
          <Card>
            <SectionHeader
              title="Gastos por categoria"
              right={
                <MicroLabel>{fmtPct(data.expenseCents, data.incomeCents)} da renda</MicroLabel>
              }
            />
            {categories.categories.length === 0 ? (
              <EmptyState>Nenhuma despesa neste mês.</EmptyState>
            ) : (
              <>
                <StackedBar
                  height={10}
                  label="Composição das despesas do mês"
                  segments={categories.categories.map((c) => ({
                    id: c.id,
                    label: c.name,
                    value: c.spentCents,
                    color: c.color,
                  }))}
                />
                <div className={s.list}>
                  {categories.categories.map((c) => (
                    <div key={c.id} className={s.listRow}>
                      <span className={s.listMain}>
                        <CategoryDot color={c.color} size={8} />
                        <span className={s.listName}>{c.name}</span>
                        <span className={s.listMeta}>
                          {c.count === 1 ? "1 lançamento" : `${c.count} lançamentos`}
                        </span>
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Pct value={pctOf(c.spentCents, data.expenseCents)} tone="muted" />
                        <Money cents={c.spentCents} size="sm" />
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
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
                        {shortDate(d.dueDate)} · {d.fixed ? "fixa" : "variável"} · {d.categoryName}
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
                ...categories.categories.map((c) => ({
                  id: c.id,
                  label: c.name,
                  value: c.spentCents,
                  color: c.color,
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
                ...categories.categories.map((c) => ({
                  id: c.id,
                  name: c.name,
                  value: c.spentCents,
                  color: c.color,
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
  testId,
}: {
  label: string;
  value: Cents;
  note: string;
  tone: "pos" | "neg" | "info" | "onAccent";
  hero?: boolean;
  /**
   * Gancho de teste explicito.
   *
   * Casar por texto aqui e' fragil: "Em conta" tambem e' o rotulo do rodape da
   * barra lateral, e um seletor por texto pegava o errado sem avisar — foi
   * exatamente assim que um spec passou a comparar o numero errado.
   */
  testId?: string;
}) {
  return (
    <div className={hero ? `${s.kpi} ${s.kpiHero}` : s.kpi} data-kpi={testId}>
      <span className={s.kpiLabel}>
        <MicroLabel>{label}</MicroLabel>
      </span>
      <Money cents={value} size="xl" tone={tone} />
      <span className={s.kpiNote}>{note}</span>
    </div>
  );
}

/** "há 3 dias", "hoje" — o que se quer saber e' a distancia, nao a data. */
function desdeQuando(at: Date | null): string {
  if (!at) return "—";
  const dias = Math.floor((Date.now() - at.getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

function quandoExato(at: Date): string {
  return at.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Três dias sem lançar já é o bastante para o mês começar a mentir. */
function precisaLancar(at: Date | null): boolean {
  if (!at) return true;
  return Date.now() - at.getTime() > 3 * 86_400_000;
}

function HealthItem({
  label,
  value,
  note,
  alerta,
}: {
  label: string;
  value: string;
  note: string;
  alerta?: boolean;
}) {
  return (
    <div className={alerta ? `${s.healthItem} ${s.healthAlert}` : s.healthItem}>
      <MicroLabel>{label}</MicroLabel>
      <span className={s.healthValue}>{value}</span>
      <span className={s.healthNote}>{note}</span>
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
