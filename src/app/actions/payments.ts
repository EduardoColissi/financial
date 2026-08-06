"use server";

import { revalidatePath } from "next/cache";
import { parseBRL } from "@/domain/money";
import { plainDate, todayInTimeZone } from "@/domain/period";
import { getContext } from "@/services/context";
import {
  PaymentError,
  payCharge,
  payStatement,
  setChargeAmount,
  unpayCharge,
  unpayStatement,
} from "@/services/payments";

/**
 * Pagar e desfazer pagamento.
 *
 * Actions finas: leem o formulario, delegam ao servico. A regra de que pagar
 * move caixa E fecha o pendente na mesma transacao mora la', nao aqui.
 */

export interface PaymentState {
  ok: boolean;
  error?: string;
}

/** Invalida o layout do mes: os dois numeros do topo e os badges mudam juntos. */
function revalidar(): void {
  revalidatePath("/[month]", "layout");
}

function recusa(err: unknown): PaymentState {
  if (err instanceof PaymentError) return { ok: false, error: err.message };
  throw err;
}

export async function payChargeAction(
  _prev: PaymentState,
  formData: FormData
): Promise<PaymentState> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Cobrança não informada." };

  const dataBruta = String(formData.get("paidOn") ?? "").trim();
  const valorBruto = String(formData.get("amount") ?? "").trim();

  try {
    await payCharge(
      ctx,
      id,
      dataBruta ? plainDate(dataBruta) : todayInTimeZone(ctx.timezone),
      valorBruto ? parseBRL(valorBruto) : undefined
    );
  } catch (err) {
    return recusa(err);
  }

  revalidar();
  return { ok: true };
}

export async function unpayChargeAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "");
  if (id) await unpayCharge(ctx, id);
  revalidar();
}

export async function setChargeAmountAction(
  _prev: PaymentState,
  formData: FormData
): Promise<PaymentState> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "");
  const bruto = String(formData.get("amount") ?? "").trim();
  if (!id || !bruto) return { ok: false, error: "Informe o valor." };

  try {
    await setChargeAmount(ctx, id, parseBRL(bruto));
  } catch (err) {
    return recusa(err);
  }

  revalidar();
  return { ok: true };
}

export async function payStatementAction(
  _prev: PaymentState,
  formData: FormData
): Promise<PaymentState> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, error: "Fatura não informada." };

  const dataBruta = String(formData.get("paidOn") ?? "").trim();
  const valorBruto = String(formData.get("amount") ?? "").trim();

  try {
    await payStatement(
      ctx,
      id,
      dataBruta ? plainDate(dataBruta) : todayInTimeZone(ctx.timezone),
      valorBruto ? parseBRL(valorBruto) : undefined
    );
  } catch (err) {
    return recusa(err);
  }

  revalidar();
  return { ok: true };
}

export async function unpayStatementAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "");
  if (id) await unpayStatement(ctx, id);
  revalidar();
}
