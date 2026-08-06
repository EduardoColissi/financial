import "server-only";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { nowInstant } from "@/domain/period";
import { SESSION_COOKIE, type Session, verifySessionToken } from "@/lib/session";

/**
 * Camada 2 do gate — a fronteira de autorizacao de verdade.
 *
 * O `proxy.ts` e' um filtro na borda; quem autoriza e' isto aqui, chamado de
 * dentro de cada leitura, action e route handler. Nao e' redundancia
 * decorativa: Server Functions sao POST na rota onde foram usadas, entao mover
 * um componente de lugar pode tira-las do matcher do proxy sem nenhum aviso.
 *
 * Quem CRIA sessao e' `google-auth.ts`. Este modulo so' le' e derruba — e' o que
 * mantem a troca do metodo de login (passphrase ontem, Google hoje) sem efeito
 * sobre as sete abas do painel.
 */

export class UnauthorizedError extends Error {
  constructor() {
    super("Sessão ausente ou inválida.");
  }
}

/** A sessao desta requisicao, ou `null`. Nao redireciona. */
export const readSession = cache(async (): Promise<Session | null> => {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value, nowInstant());
});

/**
 * Para paginas, layouts e Server Actions.
 *
 * `redirect()` lanca uma excecao de controle de fluxo que o Next entende, entao
 * nada abaixo desta linha executa sem sessao.
 */
export async function requireSession(): Promise<Session> {
  const session = await readSession();
  if (!session) redirect("/login");
  return session;
}

/**
 * Para route handlers.
 *
 * Devolve `null` em vez de redirecionar: um cliente que chamou `/api/...`
 * espera um status, nao a pagina de login em HTML.
 */
export async function requireApiSession(): Promise<Session | null> {
  return readSession();
}

export function unauthorizedJson(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

/**
 * Sessao cujo usuario AINDA EXISTE. So' a tela de login precisa disto.
 *
 * `readSession()` confere assinatura e prazo, e nada mais — de proposito, para
 * nao pagar ida ao banco em toda requisicao. Mas cookie bem assinado apontando
 * para usuario apagado (banco recriado pelo seed, por exemplo) criava um laco:
 * `getContext()` nao achava a linha e mandava para `/login`; `/login` via
 * assinatura valida e mandava de volta; o navegador ficava girando entre os
 * dois ate' desistir.
 *
 * Conferir a existencia AQUI, e so' aqui, quebra o laco no unico ponto que
 * decide "ja' esta' logado?" — sem custo nas outras rotas.
 */
export const readLiveSession = cache(async (): Promise<Session | null> => {
  const session = await readSession();
  if (!session) return null;
  const row = await db.query.users.findFirst({ where: eq(users.id, session.sub) });
  return row ? session : null;
});

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
