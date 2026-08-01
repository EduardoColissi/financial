import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hash da passphrase do gate de acesso.
 *
 * scrypt do `node:crypto`: sem dependencia, sem build nativo, e caro em memoria
 * — o que torna ataque com hardware dedicado impraticavel, ao contrario de um
 * SHA simples, que uma GPU percorre aos bilhoes por segundo.
 *
 * A senha em claro nunca e' gravada em lugar nenhum. O que vai para o
 * `.env.local` e para a Vercel e' so' o resultado daqui.
 */

const N = 16384; // custo de CPU/memoria
const R = 8;
const P = 1;
const KEY_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

/** Comparacao em tempo constante — nao vaza informacao pelo tempo de resposta. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expected = parts[5];
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p) || !salt || !expected) {
    return false;
  }

  const expectedBuf = Buffer.from(expected, "base64url");
  const derived = scryptSync(password, Buffer.from(salt, "base64url"), expectedBuf.length, {
    N: n,
    r,
    p,
  });
  return derived.length === expectedBuf.length && timingSafeEqual(derived, expectedBuf);
}

/**
 * O app fica numa URL publica sem MFA: o comprimento da frase e' o unico fator
 * que torna forca bruta impraticavel.
 */
export const MIN_PASSPHRASE_LENGTH = 20;
