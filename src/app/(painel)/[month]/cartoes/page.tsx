import { notFound } from "next/navigation";
import { parseMonthParam } from "@/domain/period";
import { Cards } from "@/features/cartoes/Cards";
import { getCards } from "@/services/cards";
import { getContext } from "@/services/context";

export default async function CartoesPage({ params }: { params: Promise<{ month: string }> }) {
  const { month: raw } = await params;
  const month = parseMonthParam(raw);
  if (!month) notFound();

  const ctx = await getContext();
  const data = await getCards(ctx, month);

  return <Cards data={data} hoje={ctx.today} />;
}
