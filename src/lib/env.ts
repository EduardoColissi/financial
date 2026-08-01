import "server-only";
import { z } from "zod";

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
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Variaveis de ambiente invalidas:\n${issues}`);
  }
  return parsed.data;
}

const parsed = load();

export const env = {
  ...parsed,
  fakeToday: parsed.NODE_ENV === "production" ? undefined : parsed.APP_FAKE_TODAY,
} as const;
