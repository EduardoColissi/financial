import { notFound } from "next/navigation";
import { parseMonthParam } from "@/domain/period";
import { Sectors } from "@/features/investimentos/Sectors.client";
import { getContext } from "@/services/context";
import { getSectors } from "@/services/sectors";

export default async function InvestimentosPage({
  params,
}: {
  params: Promise<{ month: string }>;
}) {
  const { month: raw } = await params;
  const month = parseMonthParam(raw);
  if (!month) notFound();

  const ctx = await getContext();
  const data = await getSectors(ctx, month);

  return <Sectors data={data} />;
}
