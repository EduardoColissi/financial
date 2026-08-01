import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createInterface } from "node:readline";

/**
 * Gera o hash da passphrase do gate de acesso.
 *
 * A senha NUNCA e' digitada em linha de comando (ficaria no historico do shell),
 * nunca e' gravada em arquivo e nunca sai desta maquina. O que se copia para o
 * `.env.local` e para o dashboard da Vercel e' apenas o hash.
 *
 * scrypt do `node:crypto`: sem dependencia, sem build nativo, e resistente a
 * ataque por hardware dedicado — ao contrario de um SHA simples.
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

const MIN_LENGTH = 20;

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const output = rl as unknown as { output?: NodeJS.WriteStream; _writeToOutput?: unknown };
    // Ecoa asteriscos em vez dos caracteres reais.
    output._writeToOutput = function writeMasked(this: unknown, str: string) {
      if (str.includes(question)) output.output?.write(question);
      else output.output?.write("*");
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error(
      "Este script precisa de um terminal interativo.\n" +
        "Rode direto no seu shell:  pnpm auth:hash"
    );
    process.exit(1);
  }

  console.log("\nPassphrase do gate de acesso.");
  console.log(`Minimo ${MIN_LENGTH} caracteres. Nao aparece na tela nem no historico.\n`);

  const password = await askHidden("Passphrase: ");
  if (password.length < MIN_LENGTH) {
    console.error(`\nCurta demais: ${password.length} caracteres, minimo ${MIN_LENGTH}.`);
    console.error("O app fica numa URL publica; uma frase longa e' o que torna");
    console.error("forca bruta impraticavel.");
    process.exit(1);
  }

  const confirm = await askHidden("Repita:     ");
  if (confirm !== password) {
    console.error("\nAs duas nao conferem.");
    process.exit(1);
  }

  const hash = hashPassword(password);
  if (!verifyPassword(password, hash)) {
    console.error("\nFalha na auto-verificacao do hash. Nao use este valor.");
    process.exit(1);
  }

  console.log("\nCopie a linha abaixo para o .env.local (e para a Vercel):\n");
  console.log(`APP_PASSWORD_HASH=${hash}`);
  console.log("\nGere tambem um AUTH_SECRET diferente por ambiente:\n");
  console.log(`AUTH_SECRET=${randomBytes(32).toString("base64url")}`);
  console.log("");
}

if (process.argv[1]?.includes("hash-password")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
