import { notFound } from "next/navigation";
import { parseMonthParam } from "@/domain/period";
import { Subscriptions } from "@/features/recorrentes/Subscriptions";
import { getSubscriptions } from "@/services/charges";
import { getContext } from "@/services/context";

type RecFilter = "todos" | "assinaturas" | "parcelas";

export default async function RecorrentesPage({
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
  const filter: RecFilter = value === "assinaturas" || value === "parcelas" ? value : "todos";

  const ctx = await getContext();
  const data = await getSubscriptions(ctx, month, filter);

  return <Subscriptions data={data} filter={filter} />;
}
