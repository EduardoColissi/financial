import { describe, expect, it } from "vitest";
import { checkIdentity, type ExpectedClaims, subMatchesPinned } from "./google-identity";

/**
 * O que importa aqui sao as RECUSAS.
 *
 * O caminho feliz e' exercitado no login de verdade; o que nenhum clique cobre e'
 * o token de outro aplicativo, o vencido, o de e-mail alheio. Cada `it` abaixo
 * corresponde a uma forma de entrar que nao deve funcionar.
 */

const AGORA = 1_800_000_000; // epoch em segundos, qualquer instante fixo

const ESPERADO: ExpectedClaims = {
  clientId: "cliente-123.apps.googleusercontent.com",
  nonce: "nonce-desta-tentativa",
  allowedEmail: "dono@exemplo.com",
};

/** Monta um ID token com a assinatura que se quiser — ela nao e' conferida. */
function token(claims: Record<string, unknown>, assinatura = "assinatura-ignorada"): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}.${assinatura}`;
}

/** Declaracoes de um login legitimo. Cada teste estraga uma delas. */
const validas = (extra: Record<string, unknown> = {}) => ({
  iss: "https://accounts.google.com",
  aud: ESPERADO.clientId,
  exp: AGORA + 3600,
  nonce: ESPERADO.nonce,
  sub: "104729384756102938475",
  email: ESPERADO.allowedEmail,
  email_verified: true,
  name: "Dono do Painel",
  ...extra,
});

describe("checkIdentity", () => {
  it("aceita o token legitimo e devolve sub, email e nome", () => {
    const r = checkIdentity(token(validas()), ESPERADO, AGORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity.sub).toBe("104729384756102938475");
    expect(r.identity.email).toBe("dono@exemplo.com");
    expect(r.identity.name).toBe("Dono do Painel");
  });

  it("aceita o emissor sem esquema, que o Google tambem usa", () => {
    const r = checkIdentity(token(validas({ iss: "accounts.google.com" })), ESPERADO, AGORA);
    expect(r.ok).toBe(true);
  });

  it("ignora diferenca de caixa no e-mail", () => {
    const r = checkIdentity(token(validas({ email: "Dono@Exemplo.COM" })), ESPERADO, AGORA);
    expect(r.ok).toBe(true);
  });

  it('aceita email_verified como a string "true"', () => {
    const r = checkIdentity(token(validas({ email_verified: "true" })), ESPERADO, AGORA);
    expect(r.ok).toBe(true);
  });

  it("nao traz nome quando o Google nao mandou", () => {
    const r = checkIdentity(token(validas({ name: undefined })), ESPERADO, AGORA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity.name).toBeUndefined();
  });

  // ── recusas ────────────────────────────────────────────────────────────────

  it("recusa token que nao tem tres partes", () => {
    expect(checkIdentity("so.duas", ESPERADO, AGORA)).toEqual({ ok: false, reason: "malformed" });
  });

  it("recusa payload que nao e' JSON", () => {
    const r = checkIdentity("cabecalho.nao-e-json.assinatura", ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "malformed" });
  });

  it("recusa payload que e' JSON mas nao e' objeto", () => {
    const b64 = Buffer.from(JSON.stringify("texto solto")).toString("base64url");
    expect(checkIdentity(`h.${b64}.s`, ESPERADO, AGORA)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("recusa emissor que nao e' o Google", () => {
    const r = checkIdentity(token(validas({ iss: "https://evil.example" })), ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "wrong-issuer" });
  });

  it("recusa emissor ausente", () => {
    const r = checkIdentity(token(validas({ iss: undefined })), ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "wrong-issuer" });
  });

  /**
   * O caso que justifica a conferencia de `aud`: o token e' do Google, esta'
   * assinado e nao venceu — mas foi emitido para OUTRO aplicativo. Sem esta
   * checagem, qualquer site com login Google viraria uma porta para este painel.
   */
  it("recusa token emitido para outro aplicativo OAuth", () => {
    const r = checkIdentity(
      token(validas({ aud: "outro-app.apps.googleusercontent.com" })),
      ESPERADO,
      AGORA
    );
    expect(r).toEqual({ ok: false, reason: "wrong-audience" });
  });

  it("recusa token vencido", () => {
    const r = checkIdentity(token(validas({ exp: AGORA - 1 })), ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("recusa token que vence exatamente agora", () => {
    const r = checkIdentity(token(validas({ exp: AGORA })), ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("recusa exp ausente ou nao numerico", () => {
    expect(checkIdentity(token(validas({ exp: "3600" })), ESPERADO, AGORA)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  /** Sem `nonce`, um token capturado numa sessao anterior seria reapresentavel. */
  it("recusa nonce de outra tentativa", () => {
    const r = checkIdentity(token(validas({ nonce: "de-outra-tentativa" })), ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "nonce-mismatch" });
  });

  it("recusa nonce ausente", () => {
    const r = checkIdentity(token(validas({ nonce: undefined })), ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "nonce-mismatch" });
  });

  it("recusa sub ausente", () => {
    const r = checkIdentity(token(validas({ sub: undefined })), ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "malformed" });
  });

  it("recusa email ausente", () => {
    const r = checkIdentity(token(validas({ email: undefined })), ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "malformed" });
  });

  /**
   * E-mail nao verificado e' texto que a conta declarou, nao fato. Aceitar isso
   * deixaria qualquer pessoa criar uma conta Google dizendo ser o dono.
   */
  it("recusa e-mail nao verificado", () => {
    const r = checkIdentity(token(validas({ email_verified: false })), ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "email-unverified" });
  });

  it("recusa email_verified ausente", () => {
    const r = checkIdentity(token(validas({ email_verified: undefined })), ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "email-unverified" });
  });

  it("recusa conta Google legitima que nao e' a permitida", () => {
    const r = checkIdentity(token(validas({ email: "outra.pessoa@gmail.com" })), ESPERADO, AGORA);
    expect(r).toEqual({ ok: false, reason: "email-not-allowed" });
  });
});

describe("subMatchesPinned", () => {
  it("aceita qualquer sub no primeiro login, quando nada foi gravado", () => {
    expect(subMatchesPinned(null, "104729384756102938475")).toBe(true);
  });

  it("aceita o mesmo sub gravado antes", () => {
    expect(subMatchesPinned("104729384756102938475", "104729384756102938475")).toBe(true);
  });

  /**
   * O cenario que o pino existe para cobrir: o e-mail passa na allowlist, mas a
   * conta por tras dele e' outra — endereco reatribuido, ou dominio que trocou
   * de dono. Sem isso, essa pessoa cairia na conta com o historico inteiro.
   */
  it("recusa outra conta Google usando o mesmo e-mail", () => {
    expect(subMatchesPinned("104729384756102938475", "999999999999999999999")).toBe(false);
  });
});
