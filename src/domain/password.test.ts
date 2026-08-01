import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("hash da passphrase", () => {
  const senha = "uma frase longa e bem aleatoria 2026";

  it("verifica a senha correta", () => {
    expect(verifyPassword(senha, hashPassword(senha))).toBe(true);
  });

  it("recusa senha errada", () => {
    expect(verifyPassword("outra coisa qualquer aqui", hashPassword(senha))).toBe(false);
  });

  it("recusa senha quase certa", () => {
    expect(verifyPassword(`${senha} `, hashPassword(senha))).toBe(false);
  });

  it("usa salt diferente a cada geracao", () => {
    // Dois hashes da mesma senha nao podem ser iguais, senao o hash vira
    // identificador e uma tabela arco-iris funciona.
    expect(hashPassword(senha)).not.toBe(hashPassword(senha));
  });

  it("recusa hash malformado em vez de explodir", () => {
    expect(verifyPassword(senha, "")).toBe(false);
    expect(verifyPassword(senha, "lixo")).toBe(false);
    expect(verifyPassword(senha, "scrypt$a$b$c$d$e")).toBe(false);
    expect(verifyPassword(senha, "md5$16384$8$1$c2FsdA$aGFzaA")).toBe(false);
  });

  it("o hash nao contem a senha em lugar nenhum", () => {
    expect(hashPassword(senha)).not.toContain(senha);
  });
});
