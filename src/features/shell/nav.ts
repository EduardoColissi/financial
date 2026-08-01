import type { RefMonth } from "@/domain/period";

/**
 * Titulos e subtitulos por aba.
 *
 * Copiados literalmente de `renderVals()` (design, linhas 1401-1410) — sao
 * texto de produto, nao invencao, e o diff visual do passo 24 compara palavra
 * por palavra.
 */
export interface NavEntry {
  slug: string;
  label: string;
  title: (month: RefMonth, monthLabel: string) => string;
  subtitle: string;
  group: "month" | "wealth";
}

export const NAV: NavEntry[] = [
  {
    slug: "",
    label: "Visão geral",
    title: (_m, label) => `Visão geral · ${label.toLowerCase()}`,
    subtitle: "entradas, saídas e compromissos do mês — rendimento de investimento não entra aqui",
    group: "month",
  },
  {
    slug: "lancamentos",
    label: "Lançamentos",
    title: () => "Lançamentos",
    subtitle: "todo income e despesa com categoria, meio de pagamento e parcelas",
    group: "month",
  },
  {
    slug: "contas",
    label: "Contas a pagar",
    title: () => "Contas a pagar",
    subtitle: "vencimentos fixos e variáveis · pagas e em aberto",
    group: "month",
  },
  {
    slug: "cartoes",
    label: "Cartões",
    title: () => "Cartões de crédito",
    subtitle: "fechamento, vencimento, melhor dia de compra, fatura paga e limite",
    group: "month",
  },
  {
    slug: "recorrentes",
    label: "Assinaturas",
    title: () => "Assinaturas e parcelas",
    subtitle: "cobranças que entram na fatura só no dia do faturamento",
    group: "month",
  },
  {
    slug: "categorias",
    label: "Categorias",
    title: () => "Categorias",
    subtitle: "para onde o dinheiro foi — agregado por grupo e detalhado por categoria",
    group: "month",
  },
  {
    slug: "investimentos",
    label: "Investimentos",
    title: () => "Investimentos",
    subtitle: "carteira, rendimento e alocação — rendimento é reinvestido, fora do fluxo de caixa",
    group: "wealth",
  },
];

export function hrefFor(month: RefMonth, slug: string): string {
  return slug ? `/${month}/${slug}` : `/${month}`;
}

/** Descobre a aba a partir do pathname (`/2026-08/contas` -> `contas`). */
export function slugFromPathname(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  return parts[1] ?? "";
}

export function entryForSlug(slug: string): NavEntry {
  return NAV.find((e) => e.slug === slug) ?? (NAV[0] as NavEntry);
}
