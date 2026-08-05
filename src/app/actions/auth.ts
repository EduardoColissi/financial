"use server";

import { redirect } from "next/navigation";
import { logout } from "@/services/auth";

/**
 * Saida do painel.
 *
 * A ENTRADA nao mora aqui: o login pelo Google e' uma navegacao GET que precisa
 * gravar cookie antes de sair do site e receber a volta de outro dominio — coisa
 * de Route Handler, em `app/api/auth/google/`. Server Action nao atende nenhum
 * dos dois lados.
 */
export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}
