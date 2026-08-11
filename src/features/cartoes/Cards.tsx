import type { CSSProperties } from "react";
import { ProgressBar, StackedBar } from "@/components/ui/bars";
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
import { brl } from "@/domain/money";
import { partsOfDate, shortDate } from "@/domain/period";
import type { CardsResult, CardView } from "@/services/cards";
import s from "./Cards.module.css";
import { PayStatement } from "./PayStatement.client";

const PHASE_LABEL = { paga: "fatura paga", fechada: "fatura em aberto", aberta: "fatura aberta" };
const PHASE_TONE = { paga: "ok", fechada: "warn", aberta: "neutral" } as const;

export function Cards({ data, hoje }: { data: CardsResult; hoje: string }) {
  return (
    <>
      <Notice tone={data.openCount > 0 ? "warn" : "pos"}>
        {data.openCount > 0
          ? `${data.openCount} fatura(s) em aberto · ${brl(data.openTotalCents)} a pagar neste mês.`
          : "Nenhuma fatura em aberto neste mês."}
      </Notice>

      <div className={s.grid}>
        {data.cards.length === 0 ? (
          <Card>
            <EmptyState>Nenhum cartão cadastrado.</EmptyState>
          </Card>
        ) : (
          data.cards.map((card) => <CardPanel key={card.id} card={card} hoje={hoje} />)
        )}
      </div>
    </>
  );
}

function CardPanel({ card, hoje }: { card: CardView; hoje: string }) {
  return (
    <Card>
      <div className={s.head}>
        <span
          className={s.mark}
          style={{ "--card-color": card.color } as CSSProperties}
          aria-hidden="true"
        />
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span className={s.name}>{card.name}</span>
          <span className={s.brand}>
            {card.brand}
            {card.lastFour ? ` · final ${card.lastFour}` : ""}
          </span>
        </div>
        <span style={{ marginLeft: "auto" }}>
          <StatusPill tone={PHASE_TONE[card.phase]}>{PHASE_LABEL[card.phase]}</StatusPill>
        </span>
      </div>

      <div className={s.card}>
        <div>
          {/*
            Quatro numeros, nao dois. O design soma a fatura fechada de um ciclo
            com as previsoes do ciclo seguinte e chama de "estimada".
          */}
          <div className={s.figures}>
            <Figure
              primary
              label="A pagar agora"
              cents={card.toPayCents}
              // O intervalo COBERTO vai ate' a vespera do fechamento: o gasto do
              // dia em que a fatura fecha ja' e' da proxima.
              hint={`${shortDate(card.periodStart)} a ${shortDate(card.periodEnd)} · vence ${shortDate(card.dueOn)}`}
            />
            <Figure label="Em formação" cents={card.formingCents} hint="já caiu nesta fatura" />
            <Figure
              label="Previsto até fechar"
              cents={card.forecastCents}
              hint="assinaturas e parcelas que ainda caem"
            />
            <Figure label="Total da fatura" cents={card.totalCents} hint="formação + previsto" />
          </div>

          <div className={s.dates}>
            <span className={s.date}>
              <MicroLabel>Fecha</MicroLabel>
              <span className={s.dateValue}>dia {String(card.closingDay).padStart(2, "0")}</span>
            </span>
            <span className={s.date}>
              <MicroLabel>Vence</MicroLabel>
              <span className={s.dateValue}>dia {String(card.dueDay).padStart(2, "0")}</span>
            </span>
            <span className={s.date}>
              <MicroLabel>Melhor dia</MicroLabel>
              <span className={s.dateValue}>dia {String(card.bestDay).padStart(2, "0")}</span>
            </span>
            <span className={s.date}>
              <MicroLabel>Fechamento</MicroLabel>
              <span className={s.dateValue}>{card.closingLabel}</span>
            </span>
          </div>

          {/*
            O único ponto em que dinheiro de cartão sai do caixa. Enquanto a
            fatura não é paga, ela conta em "pendente" e derruba a sobra sem
            tocar no "em conta" — pagar aqui é o que faz os dois convergirem.
          */}
          <PayStatement
            statementId={card.statementId}
            amountCents={card.totalCents}
            paid={card.paid}
            hoje={hoje}
          />

          <div className={s.limitRow}>
            <MicroLabel>Limite usado</MicroLabel>
            <span className={s.mono}>
              {card.usagePercent.toFixed(0)}% de {brl(card.limitCents)} · disponível{" "}
              <Money cents={card.availableCents} size="xs" tone="pos" />
            </span>
          </div>
          {/*
            O limite e' do CARTAO, nao do mes: mostra o que ja' foi gasto e
            nenhuma fatura quitou ainda. Antes a barra somava a fatura do mes
            navegado com o previsto do ciclo aberto — duas faturas diferentes,
            e o disponivel mudava conforme o usuario andava no tempo.
          */}
          <StackedBar
            height={10}
            label={`Uso do limite do ${card.name}`}
            segments={[
              {
                id: "uso",
                label: "em uso",
                value: card.usedCents,
                color: card.overUsed ? "var(--neg-bar)" : "var(--pos-soft)",
              },
              {
                id: "livre",
                label: "disponível",
                value: card.availableCents,
                color: "var(--track)",
              },
            ]}
          />
        </div>

        <div>
          <div className={s.section}>
            <SectionHeader title="Parcelamentos em curso" />
            {card.installments.length === 0 ? (
              <EmptyState>Sem parcelamentos ativos.</EmptyState>
            ) : (
              <>
                {card.installments.map((i) => (
                  <div key={i.id} className={s.row}>
                    <span className={s.rowMain}>
                      <span className={s.rowName}>{i.description}</span>
                      <span className={s.rowMeta}>{installmentLabel(i.sequence, i.total)}</span>
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className={s.progress}>
                        <ProgressBar
                          value={i.sequence}
                          total={i.total}
                          color="var(--info-bar)"
                          height={5}
                        />
                      </span>
                      <Money cents={i.amountCents} size="sm" />
                    </span>
                  </div>
                ))}
                <p className={s.note}>
                  <Money cents={card.installmentMonthlyCents} size="xs" tone="muted" />
                  /mês em parcelas ·{" "}
                  <Money cents={card.installmentRemainingCents} size="xs" tone="muted" compact /> a
                  vencer
                </p>
              </>
            )}
          </div>

          <div className={s.section}>
            <SectionHeader title="Ainda vai cair nesta fatura" />
            {card.upcoming.length === 0 ? (
              <EmptyState>Nada previsto até o fechamento.</EmptyState>
            ) : (
              card.upcoming.map((u) => (
                <div key={u.id} className={s.row}>
                  <span className={s.rowMain}>
                    <CategoryDot color={u.color} size={8} />
                    <span className={s.rowName}>{u.name}</span>
                    <span className={s.rowMeta}>dia {partsOfDate(u.dueDate).day}</span>
                  </span>
                  <Money cents={u.amountCents} size="sm" tone="muted" />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

function Figure({
  label,
  cents: value,
  hint,
  primary,
}: {
  label: string;
  cents: import("@/domain/money").Cents;
  hint: string;
  primary?: boolean;
}) {
  return (
    <div className={primary ? `${s.figure} ${s.figurePrimary}` : s.figure}>
      <MicroLabel>{label}</MicroLabel>
      <Money cents={value} size={primary ? "lg" : "md"} tone={primary ? "default" : "muted"} />
      <span className={s.figureHint}>{hint}</span>
    </div>
  );
}
