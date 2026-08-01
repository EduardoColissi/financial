import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/client";
import { appSettings, users } from "@/db/schema";
import {
  DEFAULT_TIME_ZONE,
  monthOf,
  type PlainDate,
  parseMonthParam,
  type RefMonth,
  refMonth,
  todayInTimeZone,
} from "@/domain/period";
import { env } from "@/lib/env";

/**
 * Contexto de requisicao.
 *
 * `today` entra aqui e desce por parametro para todo servico — nunca e' lido do
 * relogio la' dentro. E' o que permite congelar o tempo no QA e comparar a tela
 * com o design (que assume 01/08/2026).
 */
export interface AppContext {
  userId: string;
  timezone: string;
  today: PlainDate;
  startRefMonth: RefMonth;
  maxFutureMonths: number;
  hideValuesDefault: boolean;
}

export class NoUserError extends Error {
  constructor() {
    super("Nenhum usuario encontrado. Rode `pnpm db:seed`.");
  }
}

/**
 * Resolve o unico usuario da instalacao.
 *
 * O app e' single-user por decisao do dono, mas o schema ja' e' multi-usuario:
 * quando houver login de verdade, so' esta funcao muda.
 */
export const getContext = cache(async (): Promise<AppContext> => {
  const row = env.SINGLE_USER_ID
    ? await db.query.users.findFirst({ where: eq(users.id, env.SINGLE_USER_ID) })
    : await db.query.users.findFirst();

  if (!row) throw new NoUserError();

  const settings = await db.query.appSettings.findFirst({
    where: eq(appSettings.userId, row.id),
  });

  const timezone = row.timezone || env.APP_TIMEZONE || DEFAULT_TIME_ZONE;
  const today = todayInTimeZone(timezone, env.fakeToday);

  return {
    userId: row.id,
    timezone,
    today,
    startRefMonth: settings ? refMonth(settings.startRefMonth.slice(0, 7)) : monthOf(today),
    maxFutureMonths: settings?.maxFutureMonths ?? 24,
    hideValuesDefault: settings?.hideValuesDefault ?? false,
  };
});

/**
 * Interpreta o segmento `[month]` da rota.
 *
 * Fora da janela permitida devolve o mes corrente, em vez de erro: um link
 * antigo ou um clique repetido no botao de mes anterior nao deve quebrar a tela.
 */
export function resolveMonth(ctx: AppContext, param: string | undefined): RefMonth {
  const parsed = parseMonthParam(param);
  const current = monthOf(ctx.today);
  if (!parsed) return current;
  return parsed;
}
