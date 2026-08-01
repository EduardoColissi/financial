import type { ReactNode } from "react";
import { ProgressBar } from "@/components/ui/bars";
import { Money, Pct } from "@/components/ui/Money";
import {
  Card,
  CategoryDot,
  EmptyState,
  MicroLabel,
  Notice,
  SectionHeader,
} from "@/components/ui/primitives";
import { brl, brl0, pct } from "@/domain/money";
import { cx } from "@/lib/cx";
import type { InvestmentsResult } from "@/services/investments";
import s from "./Investments.module.css";

export function Investments({ data }: { data: InvestmentsResult }) {
  return (
    <>
      <div className={s.kpis}>
        <Kpi
          label="Patrimônio investido"
          value={<Money cents={data.totalCents} size="lg" />}
          note={`aplicado ${brl0(data.investedCents)}`}
        />
        <Kpi
          label="Ganho acumulado"
          value={
            <Money
              cents={data.gainCents}
              size="lg"
              tone={data.gainCents >= 0 ? "pos" : "neg"}
              kind={data.gainCents >= 0 ? "receita" : "despesa"}
            />
          }
          note={`${pct(data.gainPercent)} sobre o aplicado`}
        />
        <Kpi
          hero
          label="Rendimento do mês"
          value={
            <Money
              cents={data.monthReturnCents}
              size="lg"
              tone="onAccent"
              kind={data.monthReturnCents >= 0 ? "receita" : "despesa"}
            />
          }
          note={`${pct(data.monthReturnPercent)} no mês · reinvestido`}
        />
        <Kpi
          label="Proventos do mês"
          value={<Money cents={data.dividendCents} size="lg" tone="info" />}
          note="dividendos e aluguéis · reinvestidos"
        />
      </div>

      <Notice>
        Rendimento, dividendos e valorização ficam dentro da carteira e são reinvestidos — não
        aparecem como receita do mês. O fluxo de caixa só é afetado quando você aporta (saída) ou
        resgata (entrada). Aporte deste mês: {brl(data.contributionCents)}. A reserva cobre{" "}
        {data.runwayMonths.toFixed(1).replace(".", ",")} meses de custo.
      </Notice>

      <div className={s.layout}>
        <Card>
          <SectionHeader
            title="Alocação por segmento"
            sub="barra cheia = atual · barra apagada = alvo"
          />
          {data.segments.length === 0 ? (
            <EmptyState>Nenhum ativo cadastrado.</EmptyState>
          ) : (
            data.segments.map((seg) => (
              <div key={seg.id} className={s.segment}>
                <div className={s.segHead}>
                  <span className={s.segName}>
                    <CategoryDot color={seg.color} />
                    {seg.name}
                    <span className={s.segMeta}>
                      {seg.assetCount} {seg.assetCount === 1 ? "ativo" : "ativos"}
                    </span>
                  </span>
                  <Money cents={seg.valueCents} size="sm" />
                </div>

                <div className={s.bars}>
                  <ProgressBar
                    value={seg.currentPercent}
                    total={100}
                    color={seg.color}
                    height={9}
                    label={`${seg.name}: ${pct(seg.currentPercent)} da carteira`}
                  />
                  {seg.targetPercent != null ? (
                    <span className={s.targetBar}>
                      <ProgressBar
                        value={seg.targetPercent}
                        total={100}
                        color={seg.color}
                        height={5}
                      />
                    </span>
                  ) : null}
                </div>

                <div className={s.segFoot}>
                  <span>
                    atual {pct(seg.currentPercent)}
                    {seg.targetPercent != null ? ` · alvo ${pct(seg.targetPercent)}` : ""}
                  </span>
                  {seg.targetPercent != null ? (
                    <span
                      className={cx(
                        s.deviation,
                        seg.onTarget ? s.devOk : seg.deviationPP > 0 ? s.devOver : s.devUnder
                      )}
                    >
                      <Pct value={seg.deviationPP} asPoints />
                    </span>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </Card>

        <Card>
          <SectionHeader title="Caixinhas e metas" />
          {data.goals.length === 0 ? (
            <EmptyState>Nenhuma meta definida.</EmptyState>
          ) : (
            <div className={s.goals}>
              {data.goals.map((g) => (
                <div key={g.id} className={s.goal}>
                  <div className={s.goalHead}>
                    <span className={s.goalName}>{g.name}</span>
                    <span className={s.goalPct}>{g.percent.toFixed(0)}%</span>
                  </div>
                  <ProgressBar
                    value={g.currentCents}
                    total={g.targetCents}
                    color={g.color}
                    height={8}
                    label={`Progresso de ${g.name}`}
                  />
                  <div className={s.goalFoot}>
                    <Money cents={g.currentCents} size="xs" compact />
                    <span>de {brl0(g.targetCents)}</span>
                  </div>
                  <span className={s.goalFoot}>{g.deadlineLabel ?? ""}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <SectionHeader
          title="Ativos na carteira"
          sub="rendimento do mês reconstruído a partir do valor de mercado, sem contar aportes"
        />
        <table className={s.table}>
          <caption style={{ position: "absolute", left: -9999 }}>
            Ativos da carteira com segmento, aplicado, saldo, rendimento do mês, ganho, proventos e
            peso
          </caption>
          <thead>
            <tr>
              <th scope="col" className={s.th}>
                Ativo
              </th>
              <th scope="col" className={s.th} style={{ width: 150 }}>
                Segmento
              </th>
              <th scope="col" className={`${s.th} ${s.thRight}`} style={{ width: 110 }}>
                Aplicado
              </th>
              <th scope="col" className={`${s.th} ${s.thRight}`} style={{ width: 110 }}>
                Saldo
              </th>
              <th scope="col" className={`${s.th} ${s.thRight}`} style={{ width: 120 }}>
                No mês
              </th>
              <th scope="col" className={`${s.th} ${s.thRight}`} style={{ width: 120 }}>
                Ganho
              </th>
              <th scope="col" className={`${s.th} ${s.thRight}`} style={{ width: 90 }}>
                Proventos
              </th>
              <th scope="col" className={`${s.th} ${s.thRight}`} style={{ width: 70 }}>
                Peso
              </th>
            </tr>
          </thead>
          <tbody>
            {data.assets.map((a) => (
              <tr key={a.id}>
                <td className={s.td}>
                  <span className={s.assetName}>
                    <CategoryDot color={a.color} size={8} />
                    <span>
                      <span className={s.assetLabel}>{a.name}</span>
                      {a.detail ? <div className={s.assetDetail}>{a.detail}</div> : null}
                    </span>
                  </span>
                </td>
                <td className={`${s.td} ${s.assetDetail}`}>{a.segmentName}</td>
                <td className={`${s.td} ${s.tdRight}`}>
                  <Money cents={a.investedCents} size="sm" tone="muted" />
                </td>
                <td className={`${s.td} ${s.tdRight}`}>
                  <Money cents={a.valueCents} size="sm" />
                </td>
                <td className={`${s.td} ${s.tdRight}`}>
                  <span className={s.dual}>
                    <Money
                      cents={a.monthReturnCents}
                      size="sm"
                      tone={a.monthReturnCents >= 0 ? "pos" : "neg"}
                      kind={a.monthReturnCents >= 0 ? "receita" : "despesa"}
                    />
                    <span className={s.dualSub}>{pct(a.monthReturnPercent)}</span>
                  </span>
                </td>
                <td className={`${s.td} ${s.tdRight}`}>
                  <span className={s.dual}>
                    <Money
                      cents={a.gainCents}
                      size="sm"
                      tone={a.gainCents >= 0 ? "pos" : "neg"}
                      kind={a.gainCents >= 0 ? "receita" : "despesa"}
                    />
                    <span className={s.dualSub}>{pct(a.gainPercent)}</span>
                  </span>
                </td>
                <td className={`${s.td} ${s.tdRight}`}>
                  {a.dividendCents > 0 ? (
                    <Money cents={a.dividendCents} size="sm" tone="info" />
                  ) : (
                    <span className={s.assetDetail}>—</span>
                  )}
                </td>
                <td className={`${s.td} ${s.tdRight}`}>
                  <Pct value={a.weightPercent} tone="muted" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Kpi({
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
    <div className={cx(s.kpi, hero && s.kpiHero)}>
      <MicroLabel>{label}</MicroLabel>
      {value}
      <span className={s.kpiNote}>{note}</span>
    </div>
  );
}
