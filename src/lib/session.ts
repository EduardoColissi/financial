import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Cookie de sessao assinado.
 *
 * Nao ha' tabela de sessao: o proprio cookie carrega o payload e um HMAC-SHA256
 * dele. Para um painel de um usuario so' isso basta, e evita ida ao banco em
 * toda requisicao — o que, com o Neon dormindo em 5 minutos, custaria um cold
 * start so' para dizer "voce esta' logado".
 *
 * O preco: nao da' para revogar uma sessao especifica. Trocar o `AUTH_SECRET`
 * invalida TODAS de uma vez, que e' a operacao que realmente importa aqui.
 */

export const SESSION_COOKIE = "mc_session";

export interface Session {
  /** id do usuario. */
  sub: string;
  /** epoch em segundos. */
  exp: number;
}

class MissingSecretError extends Error {
  constructor() {
    super(
      "AUTH_SECRET nao configurado. Gere um com `pnpm auth:hash` e use um valor " +
        "DIFERENTE por ambiente — senao um cookie de preview abre a producao."
    );
  }
}

function secret(): string {
  if (!env.AUTH_SECRET) throw new MissingSecretError();
  return env.AUTH_SECRET;
}

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function createSessionToken(userId: string, now: Date): string {
  const exp = Math.floor(now.getTime() / 1000) + env.SESSION_MAX_AGE_DAYS * 86_400;
  const payload = b64(JSON.stringify({ sub: userId, exp } satisfies Session));
  return `${payload}.${sign(payload)}`;
}

/**
 * Devolve a sessao apenas se a assinatura confere E o prazo nao venceu.
 *
 * Verificar a assinatura ANTES de olhar o conteudo nao e' detalhe: ler o JSON
 * primeiro e so' depois conferir o HMAC ja' expos parsers a entrada nao
 * confiavel em varios sistemas.
 */
export function verifySessionToken(token: string | undefined, now: Date): Session | null {
  if (!token) return null;

  const dot = token.indexOf(".");
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = Buffer.from(sign(payload), "base64url");

  // `timingSafeEqual` exige mesmo tamanho; comprimento diferente ja' e' falha.
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { sub, exp } = parsed as Partial<Session>;
  if (typeof sub !== "string" || typeof exp !== "number") return null;
  if (exp * 1000 <= now.getTime()) return null;

  return { sub, exp };
}

/** Opcoes do cookie. `secure` cai fora de producao porque localhost e' http. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: env.SESSION_MAX_AGE_DAYS * 86_400,
  };
}
