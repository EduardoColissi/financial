/**
 * Quem o Google diz que e', e se essa pessoa pode entrar.
 *
 * Modulo puro: nao le' ambiente, nao toca em banco, nao faz rede. Recebe o ID
 * token cru e a configuracao esperada, devolve um veredito. E' o que permite
 * testar as recusas — que sao o que importa aqui — sem subir nada.
 */

/** Emissores validos. O Google usa as duas formas, com e sem esquema. */
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export interface GoogleIdentity {
  /** Identificador estavel da conta. Nunca muda, nunca e' reatribuido. */
  sub: string;
  email: string;
  name?: string;
}

export type IdentityCheck =
  | { ok: true; identity: GoogleIdentity }
  | { ok: false; reason: IdentityRefusal };

export type IdentityRefusal =
  | "malformed"
  | "wrong-issuer"
  | "wrong-audience"
  | "expired"
  | "nonce-mismatch"
  | "email-unverified"
  | "email-not-allowed";

export interface ExpectedClaims {
  clientId: string;
  nonce: string;
  allowedEmail: string;
}

/**
 * Le' o payload de um JWT SEM conferir a assinatura.
 *
 * Isso e' seguro em UM caso e so' nele: quando o token acabou de chegar como
 * resposta direta do endpoint de token do Google, por TLS. O canal ja' autentica
 * o emissor, e o OpenID Connect Core dispensa a verificacao ai' (secao 3.1.3.7).
 *
 * NUNCA use com token que passou pelo navegador — no fluxo implicito, ou vindo
 * de parametro de URL, a assinatura e' a unica coisa que separa um token
 * legitimo de um inventado pelo atacante.
 */
function readPayloadFromTrustedChannel(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;

  const payload = parts[1];
  if (!payload) return null;

  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** `email_verified` chega como boolean ou como a string "true", conforme o caso. */
function isVerified(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * Confere as declaracoes do ID token e decide o acesso.
 *
 * A ordem importa para o diagnostico, nao para a seguranca: tudo abaixo recusa
 * igual. `nowSeconds` entra por parametro porque este modulo nao le' o relogio.
 */
export function checkIdentity(
  idToken: string,
  expected: ExpectedClaims,
  nowSeconds: number
): IdentityCheck {
  const claims = readPayloadFromTrustedChannel(idToken);
  if (!claims) return { ok: false, reason: "malformed" };

  const { iss, aud, exp, nonce, email, email_verified: emailVerified, sub, name } = claims;

  if (typeof iss !== "string" || !ISSUERS.includes(iss)) {
    return { ok: false, reason: "wrong-issuer" };
  }

  // Token emitido para OUTRO cliente OAuth nao vale aqui, mesmo sendo do Google:
  // sem esta conferencia, qualquer app consegue um token e entra com ele.
  if (aud !== expected.clientId) return { ok: false, reason: "wrong-audience" };

  if (typeof exp !== "number" || exp <= nowSeconds) return { ok: false, reason: "expired" };

  // Amarra o token a ESTA tentativa de login. Sem isso, um token capturado antes
  // pode ser reapresentado.
  if (typeof nonce !== "string" || nonce !== expected.nonce) {
    return { ok: false, reason: "nonce-mismatch" };
  }

  if (typeof sub !== "string" || !sub) return { ok: false, reason: "malformed" };
  if (typeof email !== "string" || !email) return { ok: false, reason: "malformed" };

  // E-mail nao verificado nao prova nada: e' so' um texto que a conta declarou.
  if (!isVerified(emailVerified)) return { ok: false, reason: "email-unverified" };

  if (email.toLowerCase() !== expected.allowedEmail.toLowerCase()) {
    return { ok: false, reason: "email-not-allowed" };
  }

  return {
    ok: true,
    identity: { sub, email, name: typeof name === "string" ? name : undefined },
  };
}

/**
 * O `sub` gravado no primeiro login e' a identidade dali em diante.
 *
 * O e-mail continua sendo a porta (a allowlist), mas nao a fechadura: se ele um
 * dia for reatribuido a outra pessoa, ela passaria na allowlist e cairia na
 * conta com todo o historico financeiro. Comparar o `sub` fecha isso.
 */
export function subMatchesPinned(pinned: string | null, incoming: string): boolean {
  return pinned === null || pinned === incoming;
}
