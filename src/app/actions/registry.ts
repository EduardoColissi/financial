"use server";

import { revalidatePath } from "next/cache";
import {
  parseAccountForm,
  parseCardForm,
  parseCategoryForm,
  parseRecurringForm,
  RegistryError,
} from "@/domain/registry";
import { getContext } from "@/services/context";
import {
  createAccount,
  createCard,
  createCategory,
  createRecurring,
  deleteAccount,
  deleteCard,
  deleteCategory,
  deleteRecurring,
  updateAccount,
  updateCard,
  updateCategory,
  updateRecurring,
} from "@/services/registry";

/**
 * Cadastro de contas e cartoes.
 *
 * Actions finas: leem o FormData, delegam a validacao para `domain/registry`
 * (pura, testada) e o IO para `services/registry`. Nenhuma regra mora aqui.
 *
 * `getContext()` exige sessao valida. Nao e' redundancia com o `proxy.ts`:
 * Server Actions sao POST na rota onde foram usadas, entao um refactor de rota
 * pode tirar a cobertura do proxy sem ninguem notar — e middleware do Next ja'
 * teve bypass por header (CVE-2025-29927).
 */

export interface RegistryFormState {
  ok: boolean;
  error?: string;
  /** Campo que falhou, para destacar na UI. */
  field?: string;
}

/** Todo campo do formulario como texto — a validacao acontece no dominio. */
function campos(formData: FormData): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [chave, valor] of formData.entries()) {
    if (typeof valor === "string") out[chave] = valor;
  }
  return out;
}

function recusa(err: unknown): RegistryFormState {
  if (err instanceof RegistryError) return { ok: false, error: err.message, field: err.field };
  throw err;
}

/** Sidebar, saldos e os seletores do modal de lancamento mudam juntos. */
function revalidar(): void {
  revalidatePath("/[month]", "layout");
}

export async function saveAccountAction(
  _prev: RegistryFormState,
  formData: FormData
): Promise<RegistryFormState> {
  const ctx = await getContext();
  const dados = campos(formData);
  const id = (dados.id ?? "").trim();

  try {
    const draft = parseAccountForm(dados);
    if (id) await updateAccount(ctx, id, draft);
    else await createAccount(ctx, draft);
  } catch (err) {
    return recusa(err);
  }

  revalidar();
  return { ok: true };
}

export async function saveCardAction(
  _prev: RegistryFormState,
  formData: FormData
): Promise<RegistryFormState> {
  const ctx = await getContext();
  const dados = campos(formData);
  const id = (dados.id ?? "").trim();

  try {
    const draft = parseCardForm(dados);
    if (id) await updateCard(ctx, id, draft);
    else await createCard(ctx, draft);
  } catch (err) {
    return recusa(err);
  }

  revalidar();
  return { ok: true };
}

export async function saveCategoryAction(
  _prev: RegistryFormState,
  formData: FormData
): Promise<RegistryFormState> {
  const ctx = await getContext();
  const dados = campos(formData);
  const id = (dados.id ?? "").trim();

  try {
    const draft = parseCategoryForm(dados);
    if (id) await updateCategory(ctx, id, draft);
    else await createCategory(ctx, draft);
  } catch (err) {
    return recusa(err);
  }

  revalidar();
  return { ok: true };
}

export async function saveRecurringAction(
  _prev: RegistryFormState,
  formData: FormData
): Promise<RegistryFormState> {
  const ctx = await getContext();
  const dados = campos(formData);
  const id = (dados.id ?? "").trim();

  try {
    const draft = parseRecurringForm(dados);
    if (id) await updateRecurring(ctx, id, draft);
    else await createRecurring(ctx, draft);
  } catch (err) {
    return recusa(err);
  }

  revalidar();
  return { ok: true };
}

export async function deleteRecurringAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteRecurring(ctx, id);
  revalidar();
}

export async function deleteCategoryAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteCategory(ctx, id);
  revalidar();
}

/**
 * Exclusao definitiva. O `cascade` das chaves estrangeiras leva os dependentes.
 *
 * A confirmacao acontece na tela, que mostra quantos lancamentos, regras e
 * faturas vao junto — aqui nao ha' segunda pergunta: se chegou, e' para apagar.
 */
export async function deleteAccountAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteAccount(ctx, id);
  revalidar();
}

export async function deleteCardAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "");
  if (id) await deleteCard(ctx, id);
  revalidar();
}
