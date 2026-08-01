import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Sessao para os specs autenticados.
 *
 * **Por que nao logar com senha:** a passphrase real do dono nao esta' neste
 * repositorio, e injetar uma de teste se mostrou impossivel sem reescrever o
 * `.env.local` da maquina — no `next dev` do Next 16 esse arquivo vence tanto o
 * `process.env` quanto o `.env.development.local` (verificado na marra). Uma
 * suite de teste que sobrescreve o arquivo de segredos do desenvolvedor e' pior
 * do que um caminho nao coberto.
 *
 * Entao o E2E entra pelo cookie, assinado com o MESMO `AUTH_SECRET` que a
 * aplicacao usa. Isso exercita `verifySessionToken`, o `proxy.ts` e o
 * `requireSession()` de verdade.
 *
 * **O que fica descoberto:** "passphrase certa cria sessao". O caminho de
 * rejeicao esta' coberto em `seguranca.spec.ts`, e o hash em
 * `src/domain/password.test.ts`.
 */

export const STORAGE_STATE = "e2e/.auth/state.json";

/**
 * O mesmo segredo que a aplicacao vai usar.
 *
 * Na maquina do dono isso mora no `.env.local` (que o `next dev` prioriza); no
 * CI nao ha' esse arquivo e vale o `process.env`. A ordem aqui espelha a que a
 * aplicacao enxerga — se divergir, o cookie e' assinado com uma chave e
 * conferido com outra.
 */
function authSecret(): string {
  let doArquivo: string | undefined;
  try {
    doArquivo = readFileSync(".env.local", "utf8")
      .match(/^AUTH_SECRET=(.*)$/m)?.[1]
      ?.trim();
  } catch {
    // Sem .env.local (CI): cai no ambiente.
  }

  const secret = doArquivo || process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET nao encontrado nem em .env.local nem no ambiente — rode `pnpm auth:hash`."
    );
  }
  return secret;
}

/** Mesmo esquema de `src/lib/session.ts`: payload base64url + HMAC-SHA256. */
export function mintSessionToken(userId: string, agora: Date): string {
  const exp = Math.floor(agora.getTime() / 1000) + 86_400;
  const payload = Buffer.from(JSON.stringify({ sub: userId, exp })).toString("base64url");
  const assinatura = createHmac("sha256", authSecret()).update(payload).digest("base64url");
  return `${payload}.${assinatura}`;
}
