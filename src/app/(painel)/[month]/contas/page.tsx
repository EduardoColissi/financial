import { notFound } from "next/navigation";
import { parseMonthParam } from "@/domain/period";
import { Bills } from "@/features/contas/Bills";
import { getBills } from "@/services/charges";
import { getContext } from "@/services/context";

type BillFilter = "todas" | "fixas" | "variaveis";

export default async function ContasPage({
  params,
  searchParams,
}: {
  params: Promise<{ month: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ month: raw }, query] = await Promise.all([params, searchParams]);
  const month = parseMonthParam(raw);
  if (!month) notFound();

  const value = Array.isArray(query.filtro) ? query.filtro[0] : query.filtro;
  const filter: BillFilter = value === "fixas" || value === "variaveis" ? value : "todas";

  const ctx = await getContext();
  const data = await getBills(ctx, month, filter);

  return <Bills data={data} month={month} filter={filter} hoje={ctx.today} />;
}
