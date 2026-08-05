import { notFound } from "next/navigation";
import { parseMonthParam } from "@/domain/period";
import { TransactionsTable } from "@/features/lancamentos/TransactionsTable";
import { getContext } from "@/services/context";
import { getEntryFormOptions } from "@/services/entry-form";
import { getTransactions } from "@/services/queries";

export default async function LancamentosPage({
  params,
  searchParams,
}: {
  params: Promise<{ month: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Next 16: params e searchParams sao Promise.
  const [{ month: raw }, query] = await Promise.all([params, searchParams]);
  const month = parseMonthParam(raw);
  if (!month) notFound();

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const kind = one(query.tipo) ?? "todos";
  const method = one(query.meio) ?? "todos";
  const q = one(query.q) ?? "";
  const editar = one(query.editar);

  const ctx = await getContext();
  const [data, formOptions] = await Promise.all([
    getTransactions(ctx, month, { q, kind, method }),
    getEntryFormOptions(ctx, month),
  ]);

  return (
    <TransactionsTable
      data={data}
      kindFilter={kind}
      methodFilter={method}
      editando={editar}
      formOptions={formOptions}
    />
  );
}
