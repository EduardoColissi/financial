import type { CSSProperties, ReactNode } from "react";
import { ProgressBar } from "@/components/ui/bars";
import { Money } from "@/components/ui/Money";
import {
  Card,
  CategoryDot,
  EmptyState,
  MicroLabel,
  Notice,
  SectionHeader,
} from "@/components/ui/primitives";
import { StatusPill } from "@/components/ui/StatusPill";
import { installmentLabel } from "@/domain/installments";
import { addCents, brl, brl0, multiplyCents } from "@/domain/money";
import { FilterChips } from "@/features/lancamentos/filters.client";
import { cx } from "@/lib/cx";
import type { SubscriptionsResult } from "@/services/charges";
import s from "./Subscriptions.module.css";

const FILTERS = [
  ["todos", "Todos"],
  ["assinaturas", "Assinaturas"],
  ["parcelas", "Parcelados"],
] as const;

export function Subscriptions({ data, filter }: { data: SubscriptionsResult; filter: string }) {
  const subsCount = data.rows.filter((r) => r.total == null).length;
  const instCount = data.rows.filter((r) => r.total != null).length;

  return (
    <>
      <div className={s.stats}>
        <Stat
          label="Assinaturas"
          value={<Money cents={data.subscriptionsCents} size="lg" />}
          note={`${subsCount} ativas · ${brl0(multiplyCents(data.subscriptionsCents, 12))}/ano`}
        />
        <Stat
          label="Parcelas"
          value={<Money cents={data.installmentsCents} size="lg" tone="info" />}
          note={`${instCount} parcelamentos · faltam ${brl0(data.remainingCents)}`}
        />
        <Stat
          hero
          label="Já na fatura"
          value={<Money cents={data.postedCents} size="lg" tone="onAccent" />}
          note="cobranças que já foram faturadas"
        />
        <Stat
          label="Ainda previsto"
          value={<Money cents={data.forecastCents} size="lg" tone="neg" />}
          note={data.next ? `próxima: ${data.next.name} · dia ${data.next.day}` : "nada previsto"}
        />
      </div>

      <Notice tone="warn">
        Somando o previsto, este mês fecha em {brl(addCents(data.postedCents, data.forecastCents))}{" "}
        de cobranças no cartão. Elas só entram na fatura no dia do faturamento — antes disso são
        previsão, não dívida.
      </Notice>

      <Card>
        <SectionHeader
          title="Linha do tempo do faturamento"
          sub="cheio = já caiu na fatura · translúcido = ainda vai cair"
        />
        <div className={s.timeline}>
          {data.timeline.map((d) => (
            <div
              key={d.day}
              className={cx(s.day, d.today && s.dayToday)}
              style={
                {
                  "--day-bg": d.today
                    ? "var(--cal-today)"
                    : d.marks.length > 0
                      ? "rgba(255,255,255,.05)"
                      : "transparent",
                  "--day-border": d.today ? "var(--pos-soft)" : "transparent",
                } as CSSProperties
              }
              title={`dia ${d.day}: ${d.marks.length} cobrança(s)`}
            >
              <span className={s.dayMarks}>
                {d.marks.map((m) => (
                  <i
                    key={m.id}
                    className={s.mark}
                    style={
                      {
                        "--mark-color": m.color,
                        "--mark-opacity": m.posted ? "1" : "0.4",
                      } as CSSProperties
                    }
                  />
                ))}
              </span>
              <span className={s.dayNumber}>{d.day % 2 === 1 ? d.day : ""}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionHeader
          title="Cobranças recorrentes"
          right={
            <FilterChips
              param="filtro"
              options={FILTERS}
              current={filter}
              label="Filtrar cobranças"
            />
          }
        />

        {data.rows.length === 0 ? (
          <EmptyState>Nenhuma cobrança neste filtro.</EmptyState>
        ) : (
          <table className={s.table}>
            <caption style={{ position: "absolute", left: -9999 }}>
              Cobranças recorrentes do mês, com categoria, cartão, dia, tipo, progresso e valor
            </caption>
            <thead>
              <tr>
                <th scope="col" className={s.th}>
                  Cobrança
                </th>
                <th scope="col" className={s.th} style={{ width: 150 }}>
                  Categoria
                </th>
                <th scope="col" className={s.th} style={{ width: 160 }}>
                  Cartão
                </th>
                <th scope="col" className={s.th} style={{ width: 62 }}>
                  Dia
                </th>
                <th scope="col" className={s.th} style={{ width: 105 }}>
                  Tipo
                </th>
                <th scope="col" className={s.th} style={{ width: 150 }}>
                  Progresso
                </th>
                <th scope="col" className={s.th} style={{ width: 100 }}>
                  Situação
                </th>
                <th scope="col" className={`${s.th} ${s.thRight}`} style={{ width: 110 }}>
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const isInstallment = r.total != null && r.sequence != null;
                return (
                  <tr key={r.id}>
                    <td className={`${s.td} ${s.name}`}>{r.name}</td>
                    <td className={s.td}>
                      <span className={s.cat}>
                        <CategoryDot color={r.categoryColor} size={8} />
                        {r.categoryName}
                      </span>
                    </td>
                    <td className={`${s.td} ${s.mono}`}>{r.cardName ?? "—"}</td>
                    <td className={`${s.td} ${s.mono}`}>dia {String(r.day).padStart(2, "0")}</td>
                    <td className={s.td}>
                      <StatusPill tone={isInstallment ? "info" : "sub"}>
                        {isInstallment ? "parcelado" : "assinatura"}
                      </StatusPill>
                    </td>
                    <td className={s.td}>
                      {isInstallment && r.sequence != null && r.total != null ? (
                        <span className={s.progressCell}>
                          <span className={s.progressBar}>
                            <ProgressBar
                              value={r.sequence}
                              total={r.total}
                              color="var(--info-bar)"
                              height={5}
                            />
                          </span>
                          <span className={s.mono}>{installmentLabel(r.sequence, r.total)}</span>
                        </span>
                      ) : (
                        <span className={s.mono}>mensal · sem fim previsto</span>
                      )}
                    </td>
                    <td className={s.td}>
                      <StatusPill tone={r.tone}>{r.phase}</StatusPill>
                    </td>
                    <td className={`${s.td} ${s.tdRight}`}>
                      <Money cents={r.amountCents} size="sm" />
                      {r.remainingCents != null ? (
                        <div className={s.mono}>faltam {brl0(r.remainingCents)}</div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function Stat({
  label,
  value,
  note,
  hero,
}: {
  label: string;
  value: ReactNode;
  note: string;
  hero?: boolean;
}) {
  return (
    <div className={cx(s.stat, hero && s.statHero)}>
      <MicroLabel>{label}</MicroLabel>
      {value}
      <span className={s.statNote}>{note}</span>
    </div>
  );
}
