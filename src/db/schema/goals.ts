import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./core";

/**
 * Setores de investimento.
 *
 * Cada setor tem um objetivo em dinheiro, uma data-alvo, uma meta ANUAL e uma
 * fatia sugerida da sobra.
 *
 * Dinheiro entra aqui por um caminho so': um lancamento de aporte apontando
 * para o setor. Nao existe tabela de contribuicao — ela existiu, guardava o
 * mesmo dinheiro que o lancamento ja' guardava, e as duas divergiam assim que
 * uma das duas era corrigida.
 *
 * Ao contrario do caixa, o setor NAO zera no virar do mes: o envelope mensal
 * vale para o dinheiro disponivel, e o investido e' justamente o que saiu dele
 * para nao voltar. O acumulado soma todos os aportes, desde sempre.
 */
export const investmentSectors = pgTable(
  "investment_sectors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color").notNull(),

    /**
     * Quanto da sobra este setor DEVERIA receber, em pontos percentuais.
     *
     * E' indicacao, nao automacao: o app calcula o valor sugerido do mes e
     * mostra, mas quem aporta e' o dono, lancando. Repartir sozinho gravava
     * dinheiro que ninguem tinha mandado sair.
     *
     * Inteiro, e nao decimal: divisao com fracao de porcento gera centavo
     * perdido em toda distribuicao, e o dono nunca vai querer 12,5%.
     */
    sharePercent: smallint("share_percent").notNull().default(0),

    /**
     * Meta do ANO. So' valor, sem data: a data e' o proprio ano corrente.
     *
     * Responde outra pergunta que a meta total: "estou no ritmo?" em vez de
     * "quanto falta para chegar la'". Um setor pode estar a 8% do objetivo de
     * uma vida e em dia com o ano.
     */
    annualTargetCents: integer("annual_target_cents"),

    /**
     * Meta em dinheiro. Nulo quando o setor e' CALCULADO — hoje so' a reserva
     * de emergencia, cuja meta e' 6x o custo de vida e muda todo mes.
     */
    targetCents: integer("target_cents"),

    /**
     * Marca a reserva de emergencia. Ela nao tem meta fixa: a meta sai da media
     * das contas obrigatorias, e por isso amadurece a cada mes lancado.
     */
    isEmergencyFund: boolean("is_emergency_fund").notNull().default(false),

    /** Quando se pretende chegar la'. Nulo = sem prazo. */
    targetDate: date("target_date"),

    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sectors_user_name_uq").on(t.userId, sql`lower(${t.name})`),
    check("sectors_share_ck", sql`${t.sharePercent} between 0 and 100`),
    check("sectors_target_ck", sql`${t.targetCents} is null or ${t.targetCents} >= 0`),
    check(
      "sectors_annual_ck",
      sql`${t.annualTargetCents} is null or ${t.annualTargetCents} >= 0`
    ),
  ]
);

/*
 * Aqui vivia `sector_contributions`.
 *
 * Ela guardava, por setor e por mes, o mesmo dinheiro que o lancamento de aporte
 * ja' guardava — e as duas versoes divergiam assim que uma era corrigida. Hoje o
 * aporte APONTA para o setor (`transactions.sector_id`), e o acumulado e' a soma
 * dos lancamentos. Uma verdade so'.
 */
