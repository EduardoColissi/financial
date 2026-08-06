"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { deleteEntryAction } from "@/app/actions/entries";
import { deleteEffect, type EntryLink } from "@/domain/entry-edit";
import s from "./Transactions.module.css";

/**
 * Editar e excluir uma linha.
 *
 * A confirmacao mostra o ESTRAGO em vez de perguntar "tem certeza?" — mesma
 * regra dos cadastros. Aqui isso importa mais ainda, porque o efeito costuma ser
 * o contrario do esperado: apagar o pagamento do aluguel nao apaga o aluguel,
 * devolve a conta para o aberto e o dinheiro para o caixa.
 */
export function EntryActions({
  id,
  description,
  link,
}: {
  id: string;
  description: string;
  link: EntryLink;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const pathname = usePathname();
  const params = useSearchParams();

  const efeito = deleteEffect(link);

  if (!confirmando) {
    const editar = new URLSearchParams(params.toString());
    editar.set("editar", id);
    return (
      <div className={s.actions}>
        <Link href={`${pathname}?${editar.toString()}`} className={s.action} scroll={false}>
          Editar
        </Link>
        <button type="button" className={s.action} onClick={() => setConfirmando(true)}>
          Excluir
        </button>
      </div>
    );
  }

  return (
    <div className={s.confirm} role="alert">
      <p className={s.confirmText}>
        <strong>Apagar “{description}”?</strong> {efeito ?? "Some da lista, sem volta."}
      </p>
      <div className={s.actions}>
        <form action={deleteEntryAction}>
          <input type="hidden" name="id" value={id} />
          <button type="submit" className={s.danger}>
            Apagar
          </button>
        </form>
        <button type="button" className={s.action} onClick={() => setConfirmando(false)}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
