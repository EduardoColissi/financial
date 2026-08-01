import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { hashPassword, MIN_PASSPHRASE_LENGTH, verifyPassword } from "../src/domain/password";

/**
 * Gera o hash da passphrase do gate de acesso.
 *
 * A senha NUNCA e' digitada em linha de comando (ficaria no historico do shell),
 * nunca e' gravada em arquivo e nunca sai desta maquina. O que se copia para o
 * `.env.local` e para o dashboard da Vercel e' apenas o hash.
 *
 * O algoritmo vive em `src/domain/password.ts`, nao aqui: a aplicacao precisa da
 * mesma funcao para conferir a senha no login, e este arquivo importa
 * `node:readline` — que nao pode entrar no bundle do servidor.
 */

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
  console.log(
    `Minimo ${MIN_PASSPHRASE_LENGTH} caracteres. Nao aparece na tela nem no historico.\n`
  );

  const password = await askHidden("Passphrase: ");
  if (password.length < MIN_PASSPHRASE_LENGTH) {
    console.error(
      `\nCurta demais: ${password.length} caracteres, minimo ${MIN_PASSPHRASE_LENGTH}.`
    );
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
