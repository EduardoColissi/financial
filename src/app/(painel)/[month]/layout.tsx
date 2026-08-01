import { notFound } from "next/navigation";
import { parseMonthParam } from "@/domain/period";
import { Shell } from "@/features/shell/Shell";
import { getContext } from "@/services/context";
import { getEntryFormOptions } from "@/services/entry-form";
import { getShellData } from "@/services/shell";

/**
 * Layout do painel.
 *
 * O mes e' SEGMENTO DE ROTA, nao query string nem cookie. `layout.tsx` nao
 * recebe `searchParams` no App Router, mas recebe `params` — e a sidebar
 * precisa do mes tanto para o rotulo quanto para os badges. Cookie resolveria
 * a leitura, mas tiraria o mes da URL (sem link compartilhavel, sem
 * back/forward) e faria duas abas em meses diferentes brigarem entre si.
 */
export default async function PainelLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ month: string }>;
}) {
  // Next 16: `params` e' Promise.
  const { month: raw } = await params;
  const month = parseMonthParam(raw);
  if (!month) notFound();

  const ctx = await getContext();
  const [data, entryOptions] = await Promise.all([
    getShellData(ctx, month),
    // O modal de novo lancamento abre de qualquer aba, entao as opcoes descem
    // com o shell. Sao tres selects pequenos e indexados.
    getEntryFormOptions(ctx, month),
  ]);

  return (
    <Shell ctx={ctx} month={month} data={data} entryOptions={entryOptions}>
      {children}
    </Shell>
  );
}
