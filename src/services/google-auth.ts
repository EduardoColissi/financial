import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { checkIdentity, type IdentityRefusal, subMatchesPinned } from "@/domain/google-identity";
import { nowInstant } from "@/domain/period";
import { env } from "@/lib/env";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";
import { open, seal } from "@/lib/signed-blob";

/**
 * Login pelo Google — Authorization Code + PKCE, escrito a' mao.
 *
 * Sem biblioteca de auth de proposito. O fluxo cabe em um arquivo, e a
 * alternativa traria a propria camada de sessao e cookie, competindo com a que
 * ja' existe aqui (`lib/session.ts`), e' testada e tem o E2E assinando cookie em
 * cima dela. O que se ganharia em codigo alheio se perderia em duas camadas de
 * sessao discordando sobre quem esta' logado.
 *
 * O que este modulo NAO faz: verificar a assinatura do ID token. Ele chega como
 * resposta direta do endpoint do Google, por TLS — ver `google-identity.ts`.
 */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/** Cookie do vaivem. Vive so' entre o clique e a volta do Google. */
export const OAUTH_COOKIE = "mc_oauth";

/** 10 minutos: tempo de escolher a conta no Google, e nada alem disso. */
const OAUTH_TTL_SECONDS = 600;

export type LoginRefusal =
  | "not-configured"
  | "state-mismatch"
  | "exchange-failed"
  | "no-user"
  | "sub-mismatch"
  | IdentityRefusal;

export type CompleteResult = { ok: true; next: string } | { ok: false; reason: LoginRefusal };

interface Config {
  clientId: string;
  clientSecret: string;
  allowedEmail: string;
}

/** Todas as pecas configuradas, ou nada. Meia configuracao nao autentica. */
function config(): Config | null {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ALLOWED_EMAIL, AUTH_SECRET } = env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_ALLOWED_EMAIL || !AUTH_SECRET) {
    return null;
  }
  return {
    clientId: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    allowedEmail: GOOGLE_ALLOWED_EMAIL,
  };
}

export function redirectUri(): string {
  return `${env.APP_URL.replace(/\/$/, "")}/api/auth/google/callback`;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

/** PKCE S256: o desafio e' o SHA-256 do verificador. */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Monta a URL do Google e o cookie que guarda o segredo da tentativa.
 *
 * `state` defende de CSRF (a volta tem que casar com a ida), `nonce` amarra o ID
 * token a esta tentativa, e o `code_verifier` do PKCE impede que um `code`
 * interceptado seja trocado por outra pessoa. Os tres ficam no cookie assinado —
 * o navegador carrega, mas nao consegue forjar.
 */
export async function beginGoogleLogin(next: string): Promise<string | null> {
  const cfg = config();
  if (!cfg) return null;

  const state = b64url(randomBytes(16));
  const nonce = b64url(randomBytes(16));
  const { verifier, challenge } = pkcePair();

  const store = await cookies();
  store.set(OAUTH_COOKIE, seal({ state, nonce, verifier, next }, nowInstant(), OAUTH_TTL_SECONDS), {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    // `lax` e nao `strict`: a volta do Google e' navegacao de outro site, e no
    // `strict` o navegador nao mandaria o cookie — o login nunca fecharia.
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_TTL_SECONDS,
  });

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    // Sem refresh token: o painel so' precisa saber QUEM e' a pessoa, uma vez.
    // Dali em diante quem sustenta a sessao e' o cookie proprio.
    access_type: "online",
    // Forca a escolha de conta em vez de entrar direto na ultima usada — num
    // painel pessoal, entrar com a conta errada sem perceber e' pior que um
    // clique a mais.
    prompt: "select_account",
  });

  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Troca o `code` pelo ID token. Devolve `null` se o Google recusar. */
async function exchangeCode(cfg: Config, code: string, verifier: string): Promise<string | null> {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    cache: "no-store",
  });

  if (!response.ok) return null;

  const body: unknown = await response.json().catch(() => null);
  if (typeof body !== "object" || body === null) return null;

  const idToken = (body as { id_token?: unknown }).id_token;
  return typeof idToken === "string" ? idToken : null;
}

/**
 * Fecha o login: confere a volta, troca o codigo, autoriza e cria a sessao.
 *
 * O cookie do vaivem e' apagado em TODOS os caminhos, inclusive nos de recusa —
 * um `state` que sobrevive a uma tentativa falha pode ser reaproveitado.
 */
export async function completeGoogleLogin(
  code: string | null,
  state: string | null
): Promise<CompleteResult> {
  const store = await cookies();
  const guardado = open(store.get(OAUTH_COOKIE)?.value, nowInstant());
  store.delete(OAUTH_COOKIE);

  const cfg = config();
  if (!cfg) return { ok: false, reason: "not-configured" };

  if (!guardado || !code || !state) return { ok: false, reason: "state-mismatch" };

  const { state: esperado, nonce, verifier, next } = guardado;
  if (typeof esperado !== "string" || typeof nonce !== "string" || typeof verifier !== "string") {
    return { ok: false, reason: "state-mismatch" };
  }
  if (state !== esperado) return { ok: false, reason: "state-mismatch" };

  const idToken = await exchangeCode(cfg, code, verifier);
  if (!idToken) return { ok: false, reason: "exchange-failed" };

  const veredito = checkIdentity(
    idToken,
    { clientId: cfg.clientId, nonce, allowedEmail: cfg.allowedEmail },
    Math.floor(nowInstant().getTime() / 1000)
  );
  if (!veredito.ok) return { ok: false, reason: veredito.reason };

  const { sub, email } = veredito.identity;

  // O usuario do app ja' existe (seed ou bootstrap); o Google diz quem entra,
  // nao cria conta. Sem linha no banco nao ha' painel para mostrar.
  const user = env.SINGLE_USER_ID
    ? await db.query.users.findFirst({ where: (t, { eq: e }) => e(t.id, env.SINGLE_USER_ID ?? "") })
    : await db.query.users.findFirst({ where: (t, { eq: e }) => e(t.email, email) });
  if (!user) return { ok: false, reason: "no-user" };

  if (!subMatchesPinned(user.googleSub, sub)) return { ok: false, reason: "sub-mismatch" };

  // Primeiro login: grava o `sub` e passa a exigi-lo daqui em diante.
  if (user.googleSub === null) {
    await db.update(users).set({ googleSub: sub }).where(eq(users.id, user.id));
  }

  store.set(SESSION_COOKIE, createSessionToken(user.id, nowInstant()), sessionCookieOptions());
  return { ok: true, next: typeof next === "string" ? next : "/" };
}
