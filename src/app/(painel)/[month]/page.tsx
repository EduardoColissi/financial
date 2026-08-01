import { notFound } from "next/navigation";
import { parseMonthParam } from "@/domain/period";
import { Overview } from "@/features/visao/Overview";
import { getContext } from "@/services/context";
import { getOverview } from "@/services/overview";
import { getAccountBalances, getCategories, getTransactions } from "@/services/queries";

export default async function VisaoGeralPage({ params }: { params: Promise<{ month: string }> }) {
  const { month: raw } = await params;
  const month = parseMonthParam(raw);
  if (!month) notFound();

  const ctx = await getContext();
  const [data, categories, tx, balances] = await Promise.all([
    getOverview(ctx, month),
    getCategories(ctx, month),
    getTransactions(ctx, month),
    getAccountBalances(ctx),
  ]);

  return (
    <Overview
      data={data}
      categories={categories}
      latest={tx.rows.slice(0, 6)}
      accounts={balances.accounts}
      cashTotalCents={balances.totalCents}
    />
  );
}
