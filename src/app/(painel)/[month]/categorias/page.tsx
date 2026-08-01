import { notFound } from "next/navigation";
import { parseMonthParam } from "@/domain/period";
import { Categories } from "@/features/categorias/Categories";
import { getContext } from "@/services/context";
import { getOverview } from "@/services/overview";
import { getCategories } from "@/services/queries";

export default async function CategoriasPage({ params }: { params: Promise<{ month: string }> }) {
  const { month: raw } = await params;
  const month = parseMonthParam(raw);
  if (!month) notFound();

  const ctx = await getContext();
  const [data, overview] = await Promise.all([getCategories(ctx, month), getOverview(ctx, month)]);

  return <Categories data={data} incomeCents={overview.incomeCents} />;
}
