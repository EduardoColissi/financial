import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mintSessionToken, STORAGE_STATE } from "./fixtures";

/**
 * Baseline conhecido e sessao pronta.
 *
 * O seed apaga e recria o usuario, entao o id muda a cada execucao — por isso o
 * cookie e' assinado DEPOIS do seed, com o id que ele acabou de imprimir. Um
 * `storageState` gravado com o id antigo levaria a um cookie valido apontando
 * para usuario inexistente, que o app manda de volta para o login.
 */
export default function globalSetup() {
  const saida = execFileSync("pnpm", ["db:seed"], { encoding: "utf8", shell: true });
  process.stdout.write(saida);

  const userId = saida.match(/SINGLE_USER_ID=([0-9a-f-]{36})/)?.[1];
  if (!userId) throw new Error("o seed nao imprimiu o SINGLE_USER_ID");

  // O limite de tentativas e' estado compartilhado no banco: sobra de uma
  // execucao anterior bloquearia o spec de senha errada.
  execFileSync("pnpm", ["db:clear-attempts"], { stdio: "inherit", shell: true });

  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  writeFileSync(
    STORAGE_STATE,
    JSON.stringify({
      cookies: [
        {
          name: "mc_session",
          value: mintSessionToken(userId, new Date()),
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    }),
    "utf8"
  );
}
