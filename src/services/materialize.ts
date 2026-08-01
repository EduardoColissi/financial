import "server-only";
import { cache } from "react";
import { db } from "@/db/client";
import { type MaterializeResult, materializeMonth } from "@/db/materialize";
import { monthsBetween, type RefMonth, refMonth } from "@/domain/period";
import type { AppContext } from "./context";

/**
 * Fronteira de requisicao da materializacao.
 *
 * A logica vive em `@/db/materialize`, sem `server-only`, para que o seed e os
 * testes de integracao rodem exatamente o mesmo codigo. Aqui ficam apenas as
 * duas coisas que sao proprias da requisicao: as travas de navegacao temporal e
 * o `React.cache`, que garante uma unica chamada por render mesmo quando varios
 * componentes pedem o mesmo mes.
 */
export const ensureMonthMaterialized = cache(
  async (ctx: AppContext, month: RefMonth): Promise<MaterializeResult | null> => {
    // Sem estas travas, segurar o botao de mes anterior materializaria anos de
    // faturas vazias — e o de mes seguinte, decadas.
    if (month < ctx.startRefMonth) return null;
    const current = refMonth(ctx.today.slice(0, 7));
    if (monthsBetween(current, month) > ctx.maxFutureMonths) return null;

    return materializeMonth(db, { userId: ctx.userId }, month);
  }
);
