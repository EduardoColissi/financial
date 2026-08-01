import type { CSSProperties } from "react";
import { StackedBar } from "@/components/ui/bars";
import { Money } from "@/components/ui/Money";
import { Card, EmptyState, MicroLabel, SectionHeader } from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/StatusPill";
import { widthPercent } from "@/domain/math";
import { brl0 } from "@/domain/money";
import { monthLabel, type RefMonth, WEEKDAYS } from "@/domain/period";
import { FilterChips } from "@/features/lancamentos/filters.client";
import { cx } from "@/lib/cx";
import type { BillsResult, ChargeRow } from "@/services/charges";
import s from "./Bills.module.css";

const FILTERS = [
  ["todas", "Todas"],
  ["fixas", "Fixas"],
  ["variaveis", "Variáveis"],
] as const;

/** No maximo 2 pills por dia cabem na celula; o resto vira "+N". */
const MAX_PER_DAY = 2;

export function Bills({
  data,
  month,
  filter,
}: {
  data: BillsResult;
  month: RefMonth;
  filter: string;
}) {
  return (
    <>
      <div className={s.stats}>
        <Stat
          label="Total do mês"
          value={<Money cents={data.totalCents} size="lg" />}
          note={`${data.rows.length} contas neste filtro`}
        />
        <Stat
          label="Já pagas"
          value={<Money cents={data.paidCents} size="lg" tone="pos" />}
          note={`${data.paidCount} de ${data.paidCount + data.autoOpen + data.manualOpen} quitadas`}
        />
        <Stat
          label="Em aberto"
          value={<Money cents={data.openCents} size="lg" tone="neg" />}
          note={`${data.autoOpen} em débito automático · ${data.manualOpen} exigem ação`}
        />
        <Stat
          label="Fixas / variáveis"
          value={
            <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.03em" }}>
              {widthPercent(data.fixedCents, data.totalCents).toFixed(0)} /{" "}
              {(100 - widthPercent(data.fixedCents, data.totalCents)).toFixed(0)}
            </span>
          }
          note={`${brl0(data.fixedCents)} fixas · ${brl0(data.variableCents)} variáveis`}
        />
      </div>

      <div className={s.layout}>
        <Card>
          <SectionHeader
            title={`Calendário · ${monthLabel(month).toLowerCase()}`}
            right={
              <FilterChips
                param="filtro"
                options={FILTERS}
                current={filter}
                label="Filtrar contas"
              />
            }
          />

          <div className={s.weekdays} aria-hidden="true">
            {WEEKDAYS.map((d) => (
              <span key={d} className={s.weekday}>
                {d}
              </span>
            ))}
          </div>

          <div className={s.calendar}>
            {data.calendar.map((cell) => (
              <div
                key={cell.key}
                className={cx(s.cell, cell.day == null && s.cellEmpty, cell.today && s.cellToday)}
              >
                {cell.day != null ? (
                  <>
                    <span className={s.cellDay}>{cell.day}</span>
                    {cell.charges.slice(0, MAX_PER_DAY).map((c) => (
                      <span
                        key={c.id}
                        className={cx(
                          s.pill,
                          c.paid ? s.pillPaid : c.fixed ? s.pillFixed : s.pillVariable
                        )}
                        title={`${c.name} · ${brl0(c.amountCents)}`}
                      >
                        <span className={s.pillName}>{c.name}</span>
                        <span className={s.pillValue}>
                          {brl0(c.amountCents).replace("R$ ", "")}
                          {c.autopay ? " · auto" : ""}
                        </span>
                      </span>
                    ))}
                    {cell.charges.length > MAX_PER_DAY ? (
                      <span className={s.more}>+{cell.charges.length - MAX_PER_DAY} mais</span>
                    ) : null}
                  </>
                ) : null}
              </div>
            ))}
          </div>

          <div className={s.legend}>
            <Legend color="var(--cal-fixed)" label="fixa" />
            <Legend color="var(--cal-variable)" label="variável" />
            <Legend color="var(--cal-paid)" label="paga" />
          </div>
        </Card>

        <Card>
          <SectionHeader
            title="Contas do mês"
            sub="vencimentos fixos e variáveis, pagas e em aberto"
          />
          <StackedBar
            height={8}
            label="Proporção já paga"
            segments={[
              { id: "pago", label: "pagas", value: data.paidCents, color: "var(--pos-soft)" },
              { id: "aberto", label: "em aberto", value: data.openCents, color: "var(--track)" },
            ]}
          />
          <div style={{ marginTop: 14 }}>
            {data.rows.length === 0 ? (
              <EmptyState>Nenhuma conta neste filtro.</EmptyState>
            ) : (
              data.rows.map((c) => <BillRow key={c.id} charge={c} />)
            )}
          </div>
        </Card>
      </div>
    </>
  );
}

function BillRow({ charge }: { charge: ChargeRow }) {
  return (
    <div className={s.row}>
      <span className={cx(s.box, charge.paid && s.boxPaid)} aria-hidden="true">
        {charge.paid ? "✓" : ""}
      </span>
      <span className={s.rowBody}>
        <span className={cx(s.rowName, charge.paid && s.rowNamePaid)}>{charge.name}</span>
        <span className={s.rowMeta}>
          dia {String(charge.day).padStart(2, "0")} · {charge.fixed ? "fixa" : "variável"} ·{" "}
          {charge.categoryName} · {charge.autopay ? "débito automático" : "pagar manual"}
        </span>
      </span>
      <StatusPill tone={charge.tone}>{charge.paid ? "paga" : charge.phase}</StatusPill>
      <Money cents={charge.amountCents} size="sm" />
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: React.ReactNode; note: string }) {
  return (
    <div className={s.stat}>
      <MicroLabel>{label}</MicroLabel>
      {value}
      <span className={s.statNote}>{note}</span>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className={s.legendItem}>
      <i className={s.swatch} style={{ "--swatch": color } as CSSProperties} />
      {label}
    </span>
  );
}
