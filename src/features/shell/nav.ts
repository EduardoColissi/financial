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
  group: "month" | "wealth" | "setup";
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
  /**
   * Modelo NOVO: setores com objetivo e data, alimentados pela sobra do mes.
   * O anterior media desempenho de carteira — pergunta que o dono nao faz.
   */
  {
    slug: "investimentos",
    label: "Investimentos",
    title: () => "Investimentos",
    subtitle: "para onde vai o que sobra — e quando você chega lá",
    group: "wealth",
  },
  /**
   * Cadastro, nao relatorio: conta e cartao nao pertencem a mes nenhum.
   *
   * Fica sob o mesmo `/[month]/` mesmo assim, para reaproveitar o shell inteiro
   * (sidebar, troca de mes, busca) sem um segundo layout. O mes no endereco e'
   * inerte aqui — serve so' para voltar ao mes certo ao sair da aba.
   *
   * O rotulo diz "Contas e cartoes" e nao "Contas": a aba do mes ja' se chama
   * "Contas a pagar", e duas coisas com o mesmo nome no mesmo menu e' erro de
   * navegacao esperando acontecer.
   */
  {
    slug: "ajustes",
    label: "Cadastros",
    title: () => "Cadastros",
    subtitle: "contas, cartões e categorias — a base de tudo que se lança",
    group: "setup",
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
