"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { MoneyError, parseBRL } from "@/domain/money";
import { PeriodError, plainDate } from "@/domain/period";
import { getContext } from "@/services/context";
import { createEntry, EntryError } from "@/services/entries";
import { deleteEntry, updateEntry } from "@/services/entry-edit";

/**
 * Criacao de lancamento.
 *
 * A action e' fina de proposito: valida a forma da entrada, chama o servico e
 * revalida. Regra de negocio nenhuma mora aqui — a mesma regra precisa valer
 * para a previa que roda no cliente, e por isso vive em `domain/`.
 *
 * `getContext()` exige sessao valida. Nao e' redundancia com o `proxy.ts`:
 * Server Actions sao POST na rota onde foram usadas, entao um matcher afrouxado
 * ou um refactor de rota pode tirar a cobertura do proxy sem ninguem notar — e
 * middleware do Next ja' teve bypass por header (CVE-2025-29927).
 */

export interface EntryFormState {
  ok: boolean;
  /** Mensagem geral do formulario. */
  error?: string;
  /** Campo que falhou, para destacar na UI. */
  field?: string;
}

const schema = z.object({
  type: z.enum(["despesa", "receita", "aporte"]),
  amount: z.string().min(1, "Informe o valor."),
  description: z.string().trim().min(1, "Descreva o lançamento.").max(120),
  // Um dos dois, conforme o tipo. O servico exige o certo — aqui so' a forma.
  categoryId: z.union([z.uuid(), z.literal("")]),
  sectorId: z.union([z.uuid(), z.literal("")]),
  method: z.enum(["pix", "debit", "credit", "boleto", "cash", "transfer"]),
  // "acc:<uuid>" ou "card:<uuid>" — um campo so' para os dois tipos de alvo,
  // porque o formulario oferece as duas listas lado a lado como uma escolha.
  target: z.string().regex(/^(acc|card):[0-9a-f-]{36}$/, "Escolha a conta ou o cartão."),
  occurredOn: z.string(),
  installments: z.coerce.number().int().min(1, "Mínimo de 1 parcela.").max(48),
  repeats: z.boolean(),
});

export async function createEntryAction(
  _prev: EntryFormState,
  formData: FormData
): Promise<EntryFormState> {
  const ctx = await getContext();

  const parsed = schema.safeParse({
    type: formData.get("type"),
    amount: formData.get("amount"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId") ?? "",
    sectorId: formData.get("sectorId") ?? "",
    method: formData.get("method"),
    target: formData.get("target"),
    occurredOn: formData.get("occurredOn"),
    installments: formData.get("installments") || 1,
    repeats: formData.get("repeats") === "on",
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Dados inválidos.",
      field: issue ? String(issue.path[0] ?? "") : undefined,
    };
  }

  const input = parsed.data;
  const [kindOfTarget, targetId] = input.target.split(":") as ["acc" | "card", string];

  let result: Awaited<ReturnType<typeof createEntry>>;
  try {
    result = await createEntry(ctx, {
      type: input.type,
      // `parseBRL` e' a mesma funcao que le' valor em qualquer lugar do sistema:
      // aceita "1.234,56", "1234,56" e "1234.56" sem inventar um segundo parser.
      amountCents: parseBRL(input.amount),
      description: input.description,
      categoryId: input.categoryId || null,
      sectorId: input.sectorId || null,
      method: input.method,
      accountId: kindOfTarget === "acc" ? targetId : null,
      cardId: kindOfTarget === "card" ? targetId : null,
      occurredOn: plainDate(input.occurredOn),
      installments: input.installments,
      repeats: input.repeats === true,
    });
  } catch (err) {
    if (err instanceof EntryError) return { ok: false, error: err.message, field: err.field };
    if (err instanceof MoneyError) return { ok: false, error: "Valor inválido.", field: "amount" };
    if (err instanceof PeriodError)
      return { ok: false, error: "Data inválida.", field: "occurredOn" };
    throw err;
  }

  // Invalida o layout inteiro do mes: os badges da sidebar e as sete abas
  // mudam juntos quando entra dinheiro novo.
  revalidatePath("/[month]", "layout");

  // Manda o usuario para onde o lancamento realmente foi parar. Um parcelamento
  // nao aparece em "Lançamentos" — vira parcela na fatura ou conta a pagar.
  redirect(`/${result.competenceMonth}/${result.landingSlug}`);
}

/**
 * Edicao.
 *
 * O formulario nao oferece parcelas nem "repetir todo mes": as duas coisas
 * criam uma REGRA, e transformar um lancamento avulso numa regra por edicao
 * seria criar outro objeto, nao editar este. Para isso existe o cadastro de
 * contas fixas.
 */
const edicao = z.object({
  id: z.uuid(),
  amount: z.string().min(1, "Informe o valor."),
  description: z.string().trim().min(1, "Descreva o lançamento.").max(120),
  categoryId: z.union([z.uuid(), z.literal("")]),
  sectorId: z.union([z.uuid(), z.literal("")]),
  method: z.enum(["pix", "debit", "credit", "boleto", "cash", "transfer"]),
  target: z.union([z.string().regex(/^(acc|card):[0-9a-f-]{36}$/), z.literal("")]),
  occurredOn: z.string(),
});

export async function updateEntryAction(
  _prev: EntryFormState,
  formData: FormData
): Promise<EntryFormState> {
  const ctx = await getContext();

  const parsed = edicao.safeParse({
    id: formData.get("id"),
    amount: formData.get("amount"),
    description: formData.get("description"),
    categoryId: formData.get("categoryId") ?? "",
    sectorId: formData.get("sectorId") ?? "",
    method: formData.get("method"),
    target: formData.get("target") ?? "",
    occurredOn: formData.get("occurredOn"),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? "Dados inválidos.",
      field: issue ? String(issue.path[0] ?? "") : undefined,
    };
  }

  const input = parsed.data;
  const [alvo, alvoId] = input.target
    ? (input.target.split(":") as ["acc" | "card", string])
    : [null, null];

  try {
    await updateEntry(ctx, input.id, {
      description: input.description,
      amountCents: parseBRL(input.amount),
      occurredOn: plainDate(input.occurredOn),
      categoryId: input.categoryId || null,
      sectorId: input.sectorId || null,
      method: input.method,
      accountId: alvo === "acc" ? alvoId : null,
      cardId: alvo === "card" ? alvoId : null,
    });
  } catch (err) {
    if (err instanceof EntryError) return { ok: false, error: err.message, field: err.field };
    if (err instanceof MoneyError) return { ok: false, error: "Valor inválido.", field: "amount" };
    if (err instanceof PeriodError)
      return { ok: false, error: "Data inválida.", field: "occurredOn" };
    throw err;
  }

  revalidatePath("/[month]", "layout");
  return { ok: true };
}

/**
 * Exclusao definitiva.
 *
 * Nao devolve estado: a confirmacao ja' aconteceu na tela, e o que houver de
 * errado aqui (linha de outro usuario, id inexistente) nao tem o que o dono
 * possa corrigir no formulario.
 */
export async function deleteEntryAction(formData: FormData): Promise<void> {
  const ctx = await getContext();
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  try {
    await deleteEntry(ctx, id);
  } catch (err) {
    if (!(err instanceof EntryError)) throw err;
  }

  revalidatePath("/[month]", "layout");
}
