import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/safe-next";
import { beginGoogleLogin } from "@/services/google-auth";

/**
 * Comeco do login: manda para o Google.
 *
 * Rota, e nao Server Action, porque aqui e' preciso gravar o cookie do vaivem
 * ANTES de sair do site — e a volta do Google e' um GET de outro dominio, que
 * so' uma rota atende.
 *
 * Publica no `proxy.ts` pelo motivo obvio: quem chega aqui ainda nao tem sessao.
 */

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const de = safeNext(request.nextUrl.searchParams.get("de"));

  const url = await beginGoogleLogin(de);
  // Sem credencial configurada nao ha' para onde mandar. Volta para o login com
  // o motivo, em vez de despejar o usuario numa URL do Google sem client_id.
  if (!url) redirect("/login?erro=not-configured");

  redirect(url);
}
