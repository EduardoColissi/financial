import { notFound } from "next/navigation";
import { ProgressBar, StackedBar } from "@/components/ui/bars";
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
import { cents } from "@/domain/money";

/**
 * Galeria dos primitivos, para diff visual contra o design.
 *
 * Fora de producao. Existe porque comparar componente a componente cedo e' mais
 * barato do que descobrir divergencia de tipografia depois de sete abas prontas.
 */
export default function UiGallery() {
  if (process.env.NODE_ENV === "production") notFound();

  const row = { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" as const };
  const stack = { display: "flex", flexDirection: "column" as const, gap: 20, padding: 30 };

  return (
    <main style={stack}>
      <h1 style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-0.025em" }}>
        Primitivos · Meu Caixa
      </h1>

      <Card>
        <SectionHeader title="Valores" sub="tabular-nums, glifo de menos U+2212" />
        <div style={row}>
          <Money cents={cents(1240000)} size="xl" tone="pos" />
          <Money cents={cents(738945)} size="lg" tone="neg" />
          <Money cents={cents(260000)} size="md" tone="info" />
          <Money cents={cents(295990)} size="sm" />
          <Money cents={cents(1840000)} size="xs" tone="muted" compact />
        </div>
        <div style={{ ...row, marginTop: 14 }}>
          <Money cents={cents(980000)} kind="receita" size="sm" tone="pos" />
          <Money cents={cents(220000)} kind="despesa" size="sm" />
          <Money cents={cents(260000)} kind="aporte" size="sm" tone="info" />
          <Pct value={23.87} />
          <Pct value={-1.8} asPoints tone="info" />
        </div>
        <div style={{ ...row, marginTop: 14 }}>
          <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>alinhamento tabular:</span>
          <div style={{ display: "grid", gap: 2 }}>
            <Money cents={cents(111111)} size="sm" />
            <Money cents={cents(999999)} size="sm" />
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeader title="Status" sub="tom vem do domínio, cor vem dos tokens" />
        <div style={row}>
          <StatusPill tone="ok">pago</StatusPill>
          <StatusPill tone="ok">recebido</StatusPill>
          <StatusPill tone="warn">em aberto</StatusPill>
          <StatusPill tone="neutral">na fatura</StatusPill>
          <StatusPill tone="info">parcelado</StatusPill>
          <StatusPill tone="sub">assinatura</StatusPill>
        </div>
      </Card>

      <Card>
        <SectionHeader title="Barras" sub="toda largura passa por safeRatio" />
        <div style={{ display: "grid", gap: 14 }}>
          <ProgressBar value={76} total={100} label="Reserva de emergência" />
          <ProgressBar value={5} total={10} color="var(--info-bar)" height={6} />
          {/* O caso que quebra o design: denominador zero. */}
          <ProgressBar value={10} total={0} color="var(--warn)" />
          <StackedBar
            label="Para onde vai a renda"
            segments={[
              { id: "e", label: "Essencial", value: 439097, color: "var(--group-essential)" },
              { id: "q", label: "Qualidade de vida", value: 111388, color: "var(--group-quality)" },
              { id: "d", label: "Desenvolvimento", value: 43600, color: "var(--group-growth)" },
              { id: "a", label: "Aporte", value: 260000, color: "var(--info-bar)" },
              { id: "l", label: "Sobra", value: 385915, color: "rgba(255,255,255,.20)" },
            ]}
          />
          {/* Sem valor nenhum: nao pode virar NaN. */}
          <StackedBar
            label="Vazio"
            segments={[{ id: "z", label: "nada", value: 0, color: "var(--track)" }]}
          />
        </div>
      </Card>

      <Card>
        <SectionHeader title="Categorias" right={<MicroLabel>cor vem do banco</MicroLabel>} />
        <div style={row}>
          {[
            ["Moradia", "oklch(0.84 0.16 158)"],
            ["Alimentação", "oklch(0.82 0.15 88)"],
            ["Saúde", "oklch(0.76 0.13 200)"],
            ["Transporte", "oklch(0.74 0.13 265)"],
          ].map(([name, color]) => (
            <span
              key={name}
              style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}
            >
              <CategoryDot color={color as string} />
              {name}
            </span>
          ))}
        </div>
      </Card>

      <Notice>
        Rendimento, dividendos e valorização ficam dentro da carteira e são reinvestidos — não
        aparecem como receita do mês.
      </Notice>

      <Card pad="none">
        <EmptyState>Nenhum lançamento neste mês.</EmptyState>
      </Card>
    </main>
  );
}
