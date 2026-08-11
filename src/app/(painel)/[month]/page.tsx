import { notFound } from "next/navigation";
import { parseMonthParam } from "@/domain/period";
import { Overview } from "@/features/visao/Overview";
import { getCashView } from "@/services/cash";
import { getContext } from "@/services/context";
import { getOverview } from "@/services/overview";
import { getCategories, getTransactions } from "@/services/queries";

export default async function VisaoGeralPage({ params }: { params: Promise<{ month: string }> }) {
  const { month: raw } = await params;
  const month = parseMonthParam(raw);
  if (!month) notFound();

  const ctx = await getContext();
  const [data, categories, tx, cash] = await Promise.all([
    getOverview(ctx, month),
    getCategories(ctx, month),
    getTransactions(ctx, month),
    getCashView(ctx, month),
  ]);

  // Sem "saldos em conta": no envelope mensal nao existe saldo por conta. A
  // conta e' rotulo de onde o dinheiro entrou, e o dinheiro e' usado em
  // conjunto — mostrar um saldo por conta sugeriria potes separados.
  return (
    <Overview
      data={data}
      categories={categories}
      latest={tx.rows.slice(0, 6)}
      cash={cash}
      today={ctx.today}
      timezone={ctx.timezone}
    />
  );
}
