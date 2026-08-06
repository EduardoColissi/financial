import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Payload curto, assinado e com prazo — carregado em cookie, sem tabela.
 *
 * Existe para o vaivem do OAuth: `state`, `nonce` e o `code_verifier` do PKCE
 * precisam sobreviver a ida ao Google e voltar conferiveis. Guardar isso em
 * tabela custaria duas idas ao banco (uma para gravar, outra para ler) num
 * caminho que ja' e' lento, e o Neon dorme em 5 minutos.
 *
 * Deliberadamente separado de `session.ts`, que faz algo parecido: aquele modulo
 * e' espelhado por `e2e/fixtures.ts`, que assina cookie de sessao na mao. Juntar
 * os dois faria uma mudanca no vaivem do OAuth quebrar a suite de teste por um
 * motivo sem relacao nenhuma.
 */

class MissingSecretError extends Error {
  constructor() {
    super("AUTH_SECRET nao configurado — sem ele nao ha' como assinar o estado do OAuth.");
  }
}

function secret(): string {
  if (!env.AUTH_SECRET) throw new MissingSecretError();
  return env.AUTH_SECRET;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Serializa, carimba o vencimento e assina. */
export function seal(data: Record<string, unknown>, now: Date, ttlSeconds: number): string {
  const exp = Math.floor(now.getTime() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ ...data, exp })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/**
 * Devolve o conteudo apenas se a assinatura confere E o prazo nao venceu.
 *
 * Confere o HMAC ANTES de fazer parse: ler o JSON primeiro expoe o parser a
 * entrada nao confiavel, que e' como varios sistemas ja' foram abertos.
 */
export function open(token: string | undefined, now: Date): Record<string, unknown> | null {
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
  const data = parsed as Record<string, unknown>;
  if (typeof data.exp !== "number" || data.exp * 1000 <= now.getTime()) return null;

  return data;
}
