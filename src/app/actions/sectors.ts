"use server";

import { revalidatePath } from "next/cache";
import { MoneyError, parseBRL } from "@/domain/money";
import { PeriodError, plainDate } from "@/domain/period";
import { parseColor, RegistryError } from "@/domain/registry";
import { getContext } from "@/services/context";
import { createSector, deleteSector, type SectorDraft, updateSector } from "@/services/sectors";

/**
 * Setores de investimento.
 *
 * A validacao aqui e' curta porque a regra dura — fatias somando ate' 100% — so'
 * pode ser conferida com os OUTROS setores em maos, e isso vive no servico.
 */

export interface SectorFormState {
  ok: boolean;
  error?: string;
  field?: string;
}

function revalidar(): void {
  revalidatePath("/[month]", "layout");
}

function parseForm(formData: FormData): SectorDraft {
  const texto = (k: string) => String(formData.get(k) ?? "").trim();

  const name = texto("name");
  if (!name) throw new RegistryError("name", "Informe o nome do setor.");

  // O MESMO validador dos outros cadastros. Antes havia uma copia aqui, e ela
  // ficou para tras: e' assim que a cor livre entraria em conta e categoria mas
  // nao em setor.
  const color = parseColor(texto("color"));

  const fatia = Number(texto("sharePercent") || "0");
  if (!Number.isInteger(fatia) || fatia < 0 || fatia > 100) {
    throw new RegistryError("sharePercent", "A fatia vai de 0 a 100.");
  }

  const isEmergencyFund = formData.get("isEmergencyFund") === "on";

  /** Meta em dinheiro, opcional. Vazio = sem objetivo definido, nao zero. */
  function meta(campo: string, rotulo: string) {
    const bruto = texto(campo);
    if (!bruto) return null;
    let valor: ReturnType<typeof parseBRL>;
    try {
      valor = parseBRL(bruto);
    } catch (e) {
      if (e instanceof MoneyError) throw new RegistryError(campo, `${rotulo} não é um valor válido.`);
      throw e;
    }
    if (valor < 0) throw new RegistryError(campo, `${rotulo} não pode ser negativa.`);
    return valor;
  }

  // A reserva de emergencia nao aceita meta total digitada: a dela e' 6x o custo
  // de vida e muda todo mes. A meta ANUAL ela tem como qualquer outro setor.
  const targetCents = isEmergencyFund ? null : meta("target", "A meta");
  const annualTargetCents = meta("annualTarget", "A meta anual");

  const dataBruta = texto("targetDate");
  let targetDate = null;
  if (dataBruta) {
    try {
      targetDate = plainDate(dataBruta);
    } catch (e) {
      if (e instanceof PeriodError) throw new RegistryError("targetDate", "Data inválida.");
      throw e;
    }
  }

  return {
    name,
    color,
    sharePercent: fatia,
    targetCents,
    annualTargetCents,
    targetDate,
    isEmergencyFund,
  };
}

export async function saveSectorAction(
  _prev: SectorFormState,
  formData: FormData
): Promise<SectorFormState> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "").trim();

  try {
    const draft = parseForm(formData);
    if (id) await updateSector(ctx, id, draft);
    else await createSector(ctx, draft);
  } catch (err) {
    if (err instanceof RegistryError) return { ok: false, error: err.message, field: err.field };
    throw err;
  }

  revalidar();
  return { ok: true };
}

export async function deleteSectorAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteSector(ctx, id);
  revalidar();
}
