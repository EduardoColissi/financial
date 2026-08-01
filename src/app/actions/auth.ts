"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { safeNext } from "@/lib/safe-next";
import { login, logout } from "@/services/auth";

/**
 * Entrada e saida do painel.
 *
 * A senha so' existe dentro desta funcao: nao vai para log, nao vira query
 * string e nao volta no estado do formulario.
 */

export interface LoginState {
  error?: string;
}

const schema = z.object({
  passphrase: z.string().min(1),
  // Para onde voltar depois de entrar. Validado abaixo — ver `safeNext`.
  de: z.string().optional(),
});

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    passphrase: formData.get("passphrase"),
    de: formData.get("de") ?? undefined,
  });
  if (!parsed.success) return { error: "Digite a passphrase." };

  const result = await login(parsed.data.passphrase);

  if (!result.ok) {
    switch (result.reason) {
      case "rate-limited":
        return { error: "Tentativas demais. Espere 15 minutos." };
      case "not-configured":
        return {
          error: "Gate não configurado neste ambiente (APP_PASSWORD_HASH / AUTH_SECRET).",
        };
      default:
        // Mensagem unica de proposito: distinguir "senha errada" de qualquer
        // outra coisa entregaria informacao de graca a quem esta' tentando.
        return { error: "Passphrase incorreta." };
    }
  }

  redirect(safeNext(parsed.data.de));
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}
