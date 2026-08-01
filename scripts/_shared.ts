import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

/**
 * Os scripts rodam sob `tsx`, fora do Next, entao nao podem usar `@/lib/env`
 * (que importa `server-only` e explodiria). Leitura propria, deliberadamente.
 */
export function requireUrl(kind: "pooled" | "direct" = "direct"): string {
  const url =
    kind === "direct"
      ? (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL)
      : process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL nao definida. Copie .env.example para .env.local e preencha.");
  }
  return url;
}

/** Um host e' local se resolve para esta maquina. Qualquer outra coisa e' remota. */
export function isLocal(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

/**
 * Portao para operacoes destrutivas.
 *
 * O restore do plano free do Neon cobre apenas 6 horas. Um `db:reset` disparado
 * contra a branch de producao por engano nao tem volta — este guard e' a unica
 * coisa entre um comando distraido e a perda dos dados.
 */
export function assertLocalOrExit(url: string, operation: string): void {
  if (isLocal(url)) return;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "(url invalida)";
    }
  })();
  console.error(
    `\nRECUSADO: "${operation}" e' destrutivo e o banco alvo nao e' local.\n` +
      `  host: ${host}\n\n` +
      `Se a intencao e' mesmo agir sobre um banco remoto, faca manualmente e\n` +
      `crie um branch de backup no Neon antes.\n`
  );
  process.exit(1);
}
