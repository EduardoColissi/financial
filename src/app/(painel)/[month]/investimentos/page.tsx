import { notFound } from "next/navigation";
import { parseMonthParam } from "@/domain/period";
import { Investments } from "@/features/investimentos/Investments";
import { getContext } from "@/services/context";
import { getInvestments } from "@/services/investments";
import { getCategories } from "@/services/queries";

export default async function InvestimentosPage({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  const { month: raw } = await params;
  const month = parseMonthParam(raw);
  if (!month) notFound();

  const ctx = await getContext();
  // A despesa do mes entra so' para calcular quantos meses a reserva cobre.
  const categories = await getCategories(ctx, month);
  const data = await getInvestments(ctx, month, categories.totalCents);

  return <Investments data={data} />;
}
