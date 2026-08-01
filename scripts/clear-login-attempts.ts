import { Pool } from "pg";
import { assertLocalOrExit, requireUrl } from "./_shared";

/**
 * Zera o limite de tentativas de login.
 *
 * Serve para duas coisas: o `global-setup` do E2E, que precisa comecar sem
 * sobra de execucao anterior, e o dono, quando erra a passphrase cinco vezes e
 * fica trancado por quinze minutos no proprio ambiente local.
 *
 * Recusa banco remoto: em producao o bloqueio EXISTE para segurar forca bruta,
 * e apaga-lo de fora seria desligar a protecao.
 */
async function main() {
  const url = requireUrl("direct");
  assertLocalOrExit(url, "db:clear-attempts (apaga o historico de tentativas)");

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const result = await pool.query("delete from login_attempts");
    console.log(`tentativas apagadas: ${result.rowCount ?? 0}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
