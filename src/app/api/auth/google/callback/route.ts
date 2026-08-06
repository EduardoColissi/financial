import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { completeGoogleLogin } from "@/services/google-auth";

/**
 * Volta do Google.
 *
 * O `redirect_uri` registrado no console aponta exatamente para ca'. Qualquer
 * divergencia e' recusada pelo proprio Google com `redirect_uri_mismatch` —
 * falha fechada, que e' a que se quer num caminho de autenticacao.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // O usuario pode ter clicado "cancelar" na tela do Google.
  const erroDoGoogle = params.get("error");
  if (erroDoGoogle) redirect(`/login?erro=${encodeURIComponent(erroDoGoogle)}`);

  const resultado = await completeGoogleLogin(params.get("code"), params.get("state"));

  // O motivo vai na URL para o dono conseguir diagnosticar o proprio painel. Nao
  // ha' o que vazar: sao estados de configuracao e de recusa, e quem chega aqui
  // ja' passou pelo Google. A tela traduz cada um.
  if (!resultado.ok) redirect(`/login?erro=${resultado.reason}`);

  redirect(safeNext(resultado.next));
}
