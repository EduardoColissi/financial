import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { materializeMonth } from "@/db/materialize";
import { appSettings, users } from "@/db/schema";
import { addMonths, monthOf, todayInTimeZone } from "@/domain/period";
import { env } from "@/lib/env";

/**
 * Cinto de seguranca, nao dependencia.
 *
 * A materializacao de mes e' preguicosa e idempotente: acontece sozinha quando
 * alguem abre o mes. Este cron so' adianta o trabalho. O plano Hobby da Vercel
 * permite UM job por dia — se algo dependesse dele, o painel ficaria errado por
 * ate' 24 horas a cada falha.
 *
 * Fora do gate de cookie de proposito (a Vercel nao manda cookie), autenticado
 * por `CRON_SECRET`. Sem o segredo configurado o endpoint recusa tudo: um cron
 * aberto seria um jeito gratuito de fazer o Neon acordar a cada segundo.
 */

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Todo usuario com configuracao — hoje um so', mas nada aqui depende disso.
  const rows = await db
    .select({ id: users.id, timezone: users.timezone, maxFuture: appSettings.maxFutureMonths })
    .from(users)
    .leftJoin(appSettings, eq(appSettings.userId, users.id));

  const processed: Array<{ userId: string; months: string[] }> = [];

  for (const row of rows) {
    const today = todayInTimeZone(row.timezone);
    const current = monthOf(today);

    // O mes corrente e o seguinte cobrem a virada de mes, que e' o unico
    // momento em que adiantar trabalho realmente ajuda.
    const months = [current, addMonths(current, 1)];
    for (const month of months) {
      await materializeMonth(db, { userId: row.id }, month);
    }
    processed.push({ userId: row.id, months });
  }

  return Response.json({ ok: true, processed: processed.length });
}
