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
  SESSION_MAX_AGE_DAYS: z.coerce.number().int().positive().default(30),

  /**
   * Credenciais do cliente OAuth criado no Google Cloud Console.
   *
   * Opcionais no schema para o app subir sem elas — sem isso, `pnpm build` e os
   * testes exigiriam segredo de verdade. Faltando qualquer uma, o login recusa
   * com "nao configurado", que e' um erro que se le'.
   */
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

  /**
   * A UNICA conta que entra. Nao ha' cadastro: quem nao for este e-mail e'
   * recusado no callback, mesmo tendo autenticado no Google com sucesso.
   */
  GOOGLE_ALLOWED_EMAIL: z.string().email().optional(),

  /**
   * Base publica do app, usada para montar o `redirect_uri`.
   *
   * Nao e' derivada do `Host` da requisicao de proposito: esse cabecalho vem do
   * cliente, e deixar o destino do OAuth depender dele e' como se abre um open
   * redirect. O valor tem que bater EXATAMENTE com o registrado no Google —
   * divergir da' `redirect_uri_mismatch`, que falha fechado.
   */
  APP_URL: z.string().url().default("http://localhost:3005"),

  CRON_SECRET: z.string().min(1).optional(),

  APP_TIMEZONE: z.string().min(1).default("America/Sao_Paulo"),
  SINGLE_USER_ID: z.string().uuid().optional(),

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

export const env = load();
