import "server-only";
import { and, eq, gte, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db/client";
import { loginAttempts } from "@/db/schema";
import { verifyPassword } from "@/domain/password";
import { nowInstant } from "@/domain/period";
import { env } from "@/lib/env";
import {
  createSessionToken,
  SESSION_COOKIE,
  type Session,
  sessionCookieOptions,
  verifySessionToken,
} from "@/lib/session";

/**
 * Camada 2 do gate — a fronteira de autorizacao de verdade.
 *
 * O `proxy.ts` e' um filtro na borda; quem autoriza e' isto aqui, chamado de
 * dentro de cada leitura, action e route handler. Nao e' redundancia
 * decorativa: Server Functions sao POST na rota onde foram usadas, entao mover
 * um componente de lugar pode tira-las do matcher do proxy sem nenhum aviso.
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

// ── entrada ──────────────────────────────────────────────────────────────────

/** 5 tentativas por IP a cada 15 minutos. */
const WINDOW_MINUTES = 15;
const MAX_ATTEMPTS = 5;

export type LoginResult =
  | { ok: true }
  | { ok: false; reason: "wrong" | "rate-limited" | "not-configured" };

/**
 * IP do chamador.
 *
 * Atras da Vercel o socket e' sempre o do proxy; o IP real vem no
 * `x-forwarded-for`, e o PRIMEIRO da lista e' o cliente.
 */
async function callerIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || h.get("x-real-ip") || "desconhecido";
}

/**
 * Limite de tentativas em TABELA, nao em memoria.
 *
 * Em serverless cada instancia tem a propria memoria: um contador local seria
 * zerado a cada instancia fria, e quem esta' tentando forca bruta simplesmente
 * cairia noutra. O estado precisa ser compartilhado, e o banco ja' e'.
 */
async function tooManyAttempts(ip: string): Promise<boolean> {
  const since = new Date(nowInstant().getTime() - WINDOW_MINUTES * 60_000);
  const [row] = await db
    .select({ n: sql<string>`count(*)::text` })
    .from(loginAttempts)
    .where(
      and(
        eq(loginAttempts.ip, ip),
        eq(loginAttempts.succeeded, false),
        gte(loginAttempts.attemptedAt, since)
      )
    );
  return Number(row?.n ?? 0) >= MAX_ATTEMPTS;
}

export async function login(passphrase: string): Promise<LoginResult> {
  if (!env.APP_PASSWORD_HASH || !env.AUTH_SECRET) {
    return { ok: false, reason: "not-configured" };
  }

  const ip = await callerIp();
  if (await tooManyAttempts(ip)) return { ok: false, reason: "rate-limited" };

  const ok = verifyPassword(passphrase, env.APP_PASSWORD_HASH);
  await db.insert(loginAttempts).values({ ip, succeeded: ok });
  if (!ok) return { ok: false, reason: "wrong" };

  const user = env.SINGLE_USER_ID
    ? await db.query.users.findFirst({ where: (t, { eq: e }) => e(t.id, env.SINGLE_USER_ID ?? "") })
    : await db.query.users.findFirst();
  if (!user) return { ok: false, reason: "not-configured" };

  const store = await cookies();
  store.set(SESSION_COOKIE, createSessionToken(user.id, nowInstant()), sessionCookieOptions());
  return { ok: true };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}
