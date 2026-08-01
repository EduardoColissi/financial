import type { ReactNode } from "react";
import { Money, Pct } from "@/components/ui/Money";
import type { RefMonth } from "@/domain/period";
import type { AppContext } from "@/services/context";
import type { ShellData } from "@/services/shell";
import { NAV } from "./nav";
import { HeaderTitle, MonthSwitcher, NavItem, PrivacyToggle, SearchBox } from "./shell.client";
import s from "./shell.module.css";

/**
 * Casca da aplicacao: fundo, sidebar e header.
 *
 * Server Component. Os pedacos que precisam saber a rota ativa (nav, titulo,
 * troca de mes) sao ilhas client pequenas — o conteudo das abas nao desce
 * junto para o cliente.
 */
export function Shell({
  ctx,
  month,
  data,
  children,
}: {
  ctx: AppContext;
  month: RefMonth;
  data: ShellData;
  children: ReactNode;
}) {
  const badges: Record<string, { text: string; tone?: "warn" | "pos" } | undefined> = {
    "": undefined,
    lancamentos: { text: String(data.transactionsCount) },
    contas: { text: String(data.openBillsCount), tone: "warn" },
    cartoes: { text: `${data.openStatementsCount}/${data.statementsCount}` },
    recorrentes: { text: String(data.upcomingChargesCount), tone: "warn" },
    categorias: { text: String(data.categoriesCount) },
    investimentos: {
      text: `${data.monthReturnCents >= 0 ? "+" : ""}${data.monthReturnPercent.toFixed(1).replace(".", ",")}%`,
      tone: "pos",
    },
  };

  return (
    <div className={s.root}>
      {/* Clipping isolado numa camada fixa: com `overflow:hidden` na raiz o
          sticky do header e da sidebar deixaria de funcionar. */}
      <div className={s.blobs} aria-hidden="true">
        <div className={`${s.blob} ${s.blobA}`} />
        <div className={`${s.blob} ${s.blobB}`} />
        <div className={`${s.blob} ${s.blobC}`} />
      </div>

      <div className={s.shell}>
        <aside className={s.aside}>
          <div className={s.brand}>
            <div className={s.brandMark} aria-hidden="true">
              ₲
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span className={s.brandName}>Meu Caixa</span>
              <span className={s.brandSub}>finanças pessoais</span>
            </div>
          </div>

          <MonthSwitcher month={month} today={ctx.today} />

          <nav className={s.nav} aria-label="Seções do painel">
            <span className={s.navGroup}>Mês corrente</span>
            {NAV.filter((e) => e.group === "month").map((entry) => (
              <NavItem
                key={entry.slug || "home"}
                month={month}
                slug={entry.slug}
                label={entry.label}
                badge={badges[entry.slug]?.text}
                badgeTone={badges[entry.slug]?.tone}
              />
            ))}

            <span className={`${s.navGroup} ${s.navGroupSpaced}`}>Patrimônio</span>
            {NAV.filter((e) => e.group === "wealth").map((entry) => (
              <NavItem
                key={entry.slug}
                month={month}
                slug={entry.slug}
                label={entry.label}
                badge={badges[entry.slug]?.text}
                badgeTone={badges[entry.slug]?.tone}
              />
            ))}
          </nav>

          <div className={s.asideFoot}>
            <div className={s.netWorth}>
              <span className={s.netWorthLabel}>Patrimônio total</span>
              <Money cents={data.netWorthCents} size="lg" compact />
              <span className={s.netWorthNote}>
                <Money cents={data.monthReturnCents} size="xs" kind="receita" tone="pos" /> no mês ·
                reinvestido
              </span>
            </div>

            <button type="button" className={s.newButton}>
              <span className={s.newButtonPlus} aria-hidden="true">
                +
              </span>
              Novo lançamento
            </button>

            <div className={s.user}>
              <div className={s.avatar} aria-hidden="true">
                EC
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span className={s.userName}>Eduardo</span>
                <span className={s.userRole}>conta pessoal</span>
              </div>
            </div>
          </div>
        </aside>

        <div className={s.main}>
          <header className={s.header}>
            <HeaderTitle month={month} />
            <div className={s.headerActions}>
              <SearchBox />
              <PrivacyToggle />
            </div>
          </header>

          <main className={s.content}>{children}</main>
        </div>
      </div>
    </div>
  );
}

/** Placeholder das abas ainda nao implementadas. */
export function TabPlaceholder({ title, note }: { title: string; note: string }) {
  return (
    <div className={s.placeholder}>
      <span className={s.placeholderTitle}>{title}</span>
      <span className={s.placeholderText}>{note}</span>
    </div>
  );
}

export { Pct };
