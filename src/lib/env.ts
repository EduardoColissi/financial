import "server-only";
import { z } from "zod";
import { withoutBlanks } from "./env-input";

/**
 * Leitura validada do ambiente.
 *
 * Falhar aqui, no boot, e' melhor do que descobrir uma variavel faltando no
 * meio de uma transacao de dinheiro.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),

  AUTH_SECRET: z.string().min(1).optional(),
  APP_PASSWORD_HASH: z.string().min(1).optional(),
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),

  CRON_SECRET: z.string().min(1).optional(),

  APP_TIMEZONE: z.string().min(1).default("America/Sao_Paulo"),
  SINGLE_USER_ID: z.string().uuid().optional(),

  /**
   * Congela "hoje". Existe para o QA conseguir comparar a tela com o design,
   * que assume 01/08/2026 — sem isso, "vence em 7 dias" e "na fatura x prevista"
   * mudam todo dia e nao ha' como testar.
   *
   * Ignorada em producao de proposito: um valor esquecido aqui faria o app
   * inteiro operar numa data errada, silenciosamente.
   */
  APP_FAKE_TODAY: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

function load() {
  // `withoutBlanks` antes do parse: variavel declarada vazia na Vercel chega
  // como "" e reprovaria em `min(1)` — ver o modulo para o porque.
  const parsed = schema.safeParse(withoutBlanks(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("\n");
    // A dica de onde configurar vai junto: este erro costuma aparecer no log de
    // build da Vercel, onde a mensagem crua nao diz o que fazer a respeito.
    throw new Error(
      `Variaveis de ambiente invalidas:\n${issues}\n` +
        "Local: preencha o .env.local (modelo em .env.example). " +
        "Vercel: Settings > Environment Variables, no ambiente do deploy."
    );
  }
  return parsed.data;
}

const parsed = load();

export const env = {
  ...parsed,
  fakeToday: parsed.NODE_ENV === "production" ? undefined : parsed.APP_FAKE_TODAY,
} as const;
