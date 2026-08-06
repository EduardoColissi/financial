"use client";

import { useActionState, useEffect, useState } from "react";
import { deleteSectorAction, type SectorFormState, saveSectorAction } from "@/app/actions/sectors";
import { ProgressBar } from "@/components/ui/bars";
import { ColorPicker } from "@/components/ui/ColorPicker.client";
import { Money } from "@/components/ui/Money";
import { MoneyInput } from "@/components/ui/MoneyInput.client";
import { Card, EmptyState, MicroLabel, Notice, SectionHeader } from "@/components/ui/primitives";
import { brl, cents } from "@/domain/money";
import { PALETTE } from "@/domain/registry";
import type { SectorsView, SectorView } from "@/services/sectors";
import s from "./Sectors.module.css";

const INICIAL: SectorFormState = { ok: false };

function SectorForm({
  setor,
  coresUsadas,
  temReserva,
  onDone,
}: {
  setor?: SectorView;
  coresUsadas: string[];
  /** Ja' existe reserva de emergencia? So' faz sentido uma. */
  temReserva: boolean;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveSectorAction, INICIAL);
  const [reserva, setReserva] = useState(setor?.isEmergencyFund ?? false);

  useEffect(() => {
    if (state.ok) onDone();
  }, [state.ok, onDone]);

  const podeMarcarReserva = !temReserva || setor?.isEmergencyFund;

  return (
    <form action={formAction} className={s.form}>
      {setor ? <input type="hidden" name="id" value={setor.id} /> : null}

      <div className={s.grid}>
        <label className={s.field}>
          <span className={s.label}>Nome</span>
          <input
            name="name"
            className={s.input}
            defaultValue={setor?.name ?? ""}
            placeholder="Viagem"
            maxLength={40}
            required
          />
        </label>

        <label className={s.field}>
          <span className={s.label}>Fatia da sobra</span>
          <input
            name="sharePercent"
            type="number"
            min={0}
            max={100}
            className={s.input}
            defaultValue={setor?.sharePercent ?? 0}
          />
          <span className={s.hint}>Só sugere o valor do mês — quem aporta é você.</span>
        </label>

        {/* Reserva de emergência não digita meta: são 6× o custo de vida. */}
        {reserva ? null : (
          <label className={s.field}>
            <span className={s.label}>Objetivo</span>
            <MoneyInput
              name="target"
              className={s.input}
              defaultCents={setor && !setor.isEmergencyFund ? setor.targetCents : null}
            />
            <span className={s.hint}>Onde você quer chegar, sem prazo curto.</span>
          </label>
        )}

        <label className={s.field}>
          <span className={s.label}>Meta do ano</span>
          <MoneyInput
            name="annualTarget"
            className={s.input}
            defaultCents={setor?.annual.targetCents || null}
            placeholder="opcional"
          />
          <span className={s.hint}>Quanto pretende aportar aqui neste ano.</span>
        </label>

        <label className={s.field}>
          <span className={s.label}>Quero até</span>
          <input
            name="targetDate"
            type="date"
            className={s.input}
            defaultValue={setor?.targetDate ?? ""}
          />
          <span className={s.hint}>Define quanto precisa entrar por mês.</span>
        </label>

        <div className={s.field}>
          <span className={s.label}>Cor</span>
          <ColorPicker
            name="color"
            atual={setor?.color ?? PALETTE.find((x) => !coresUsadas.includes(x)) ?? PALETTE[0]}
          />
        </div>
      </div>

      {podeMarcarReserva ? (
        <label className={s.check}>
          <input
            type="checkbox"
            name="isEmergencyFund"
            defaultChecked={setor?.isEmergencyFund ?? false}
            onChange={(e) => setReserva(e.target.checked)}
          />
          <span>
            É a reserva de emergência
            <span className={s.hint}>
              {" "}
              — a meta vira 6× o custo de vida, e sobe conforme você lança
            </span>
          </span>
        </label>
      ) : null}

      {state.error ? (
        <p className={s.error} role="alert">
          {state.error}
        </p>
      ) : null}

      <div className={s.actions}>
        <button type="submit" className={s.primary} disabled={pending}>
          {pending ? "Salvando…" : setor ? "Salvar" : "Criar setor"}
        </button>
        <button type="button" className={s.ghost} onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

export function Sectors({ data }: { data: SectorsView }) {
  const [editando, setEditando] = useState<string | null>(null);
  const cores = data.sectors.map((x) => x.color);
  const temReserva = data.sectors.some((x) => x.isEmergencyFund);
  const excedeu = data.totalSharePercent > 100;

  return (
    <>
      <Notice tone={excedeu ? "warn" : "pos"}>
        {excedeu
          ? `As fatias somam ${data.totalSharePercent}% — acima de 100% a sugestão não fecha.`
          : `A sobra deste mês é ${brl(data.leftoverCents)}. ${data.totalSharePercent}% dela tem destino sugerido${
              data.unallocatedCents > 0 ? `, e ${brl(data.unallocatedCents)} ficam sem` : ""
            }.`}
      </Notice>

      {/*
        O indicador do ANO, e não do mês: é a pergunta que o painel mensal não
        responde. O caixa zera toda virada de mês; o investido, não — ele é
        justamente o que saiu do caixa para não voltar.
      */}
      {data.annualTargetCents > 0 ? (
        <Card>
          <SectionHeader
            title={`Meta de ${data.year}`}
            sub="quanto do objetivo anual já foi aportado"
            right={
              <MicroLabel>
                {Math.round((data.investedThisYearCents / data.annualTargetCents) * 100)}%
              </MicroLabel>
            }
          />
          <div className={s.numbers}>
            <span>
              <Money cents={data.investedThisYearCents} size="lg" />
              <span className={s.of}>de {brl(data.annualTargetCents)}</span>
            </span>
          </div>
          <ProgressBar
            value={data.investedThisYearCents}
            total={Math.max(1, data.annualTargetCents)}
            height={8}
          />
        </Card>
      ) : null}

      <div className={s.head}>
        <div>
          <h2 className={s.title}>Setores</h2>
          <p className={s.sub}>
            A fatia sugere quanto da sobra vai para cada um. O aporte você faz em Lançamentos.
          </p>
        </div>
        <div className={s.headActions}>
          <button
            type="button"
            className={s.ghost}
            onClick={() => setEditando(editando === "novo" ? null : "novo")}
          >
            Novo setor
          </button>
        </div>
      </div>

      {editando === "novo" ? (
        <Card>
          <SectorForm
            coresUsadas={cores}
            temReserva={temReserva}
            onDone={() => setEditando(null)}
          />
        </Card>
      ) : null}

      {data.sectors.length === 0 ? (
        <Card>
          <EmptyState>
            Nenhum setor ainda. Comece pela reserva de emergência — a meta dela sai sozinha do seu
            custo de vida.
          </EmptyState>
        </Card>
      ) : (
        <div className={s.grid2}>
          {data.sectors.map((setor) => (
            <Card key={setor.id}>
              {editando === setor.id ? (
                <SectorForm
                  setor={setor}
                  coresUsadas={cores.filter((c) => c !== setor.color)}
                  temReserva={temReserva}
                  onDone={() => setEditando(null)}
                />
              ) : (
                <>
                  <SectionHeader
                    title={setor.name}
                    right={<MicroLabel>{setor.sharePercent}% da sobra</MicroLabel>}
                  />

                  <div className={s.numbers}>
                    <span>
                      <Money cents={setor.accumulatedCents} size="lg" />
                      <span className={s.of}>
                        de {setor.targetCents > 0 ? brl(setor.targetCents) : "meta não definida"}
                      </span>
                    </span>
                    {setor.isEmergencyFund ? (
                      <span className={s.badge}>meta automática · 6× custo de vida</span>
                    ) : null}
                  </div>

                  <ProgressBar
                    value={setor.accumulatedCents}
                    total={Math.max(1, setor.targetCents)}
                    color={setor.color}
                    height={8}
                  />

                  <p className={s.meta}>
                    {setor.reached ? (
                      <strong>Objetivo atingido.</strong>
                    ) : (
                      <>
                        Faltam <strong>{brl(setor.missingCents)}</strong>
                        {setor.monthsLeft != null ? (
                          <>
                            {" "}
                            em {setor.monthsLeft} {setor.monthsLeft === 1 ? "mês" : "meses"} —{" "}
                            {brl(setor.neededPerMonthCents ?? cents(0))}/mês
                          </>
                        ) : null}
                        .
                      </>
                    )}
                  </p>

                  {/*
                    Sugerido e aportado lado a lado. Mostrar só o sugerido faria
                    o número parecer um fato — e ele é um conselho que ninguém
                    seguiu até o aporte ser lançado.
                  */}
                  <p className={s.meta}>
                    A fatia sugere <strong>{brl(setor.suggestedCents)}</strong> neste mês.{" "}
                    {setor.thisMonthCents > 0 ? (
                      <>
                        Já entraram <strong>{brl(setor.thisMonthCents)}</strong>.
                      </>
                    ) : (
                      "Nada aportado ainda."
                    )}
                  </p>

                  {setor.annual.targetCents > 0 ? (
                    <p className={s.meta}>
                      No ano: <strong>{brl(setor.annual.investedCents)}</strong> de{" "}
                      {brl(setor.annual.targetCents)}
                      {setor.annual.reached ? (
                        <> — meta do ano batida.</>
                      ) : (
                        <> — faltam {brl(setor.annual.missingCents)}.</>
                      )}
                    </p>
                  ) : null}

                  <div className={s.actions}>
                    <button type="button" className={s.ghost} onClick={() => setEditando(setor.id)}>
                      Editar
                    </button>
                    <form action={deleteSectorAction}>
                      <input type="hidden" name="id" value={setor.id} />
                      <button type="submit" className={s.ghost}>
                        Excluir
                      </button>
                    </form>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
