"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { addMonths, monthLabel, type RefMonth, refMonth } from "@/domain/period";
import { cx } from "@/lib/cx";
import { hrefFor, NAV, slugFromPathname } from "./nav";
import s from "./shell.module.css";

/**
 * Ilhas client do shell.
 *
 * Sao pequenas de proposito: tudo que depende de `usePathname` precisa rodar no
 * cliente, mas nada mais desce junto. O conteudo das abas permanece Server
 * Component.
 */

const HIDE_KEY = "mc:hide-values";

/** Item de navegacao. Client apenas para saber qual esta' ativo. */
export function NavItem({
  month,
  slug,
  label,
  badge,
  badgeTone,
}: {
  month: RefMonth;
  slug: string;
  label: string;
  badge?: string;
  badgeTone?: "warn" | "pos";
}) {
  const pathname = usePathname();
  const active = slugFromPathname(pathname) === slug;

  return (
    <Link
      href={hrefFor(month, slug)}
      className={cx(s.navItem, active && s.navItemActive)}
      aria-current={active ? "page" : undefined}
    >
      <span>{label}</span>
      {badge ? (
        <span
          className={cx(
            s.navBadge,
            badgeTone === "warn" && s.navBadgeWarn,
            badgeTone === "pos" && s.navBadgePos
          )}
        >
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

/**
 * Navegacao de mes.
 *
 * Preserva a aba atual — trocar de mes em "Cartões" tem que continuar em
 * "Cartões". Por isso e' client: o layout nao sabe qual segmento filho esta'
 * ativo, so' o pathname sabe.
 */
export function MonthSwitcher({ month, today }: { month: RefMonth; today: string }) {
  const pathname = usePathname();
  const slug = slugFromPathname(pathname);
  const [d, m] = [today.slice(8, 10), today.slice(5, 7)];

  return (
    <div className={s.monthBox}>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span className={s.monthName}>{monthLabel(month)}</span>
        <span className={s.monthToday}>
          hoje · {d}/{m}
        </span>
      </div>
      <div className={s.monthNav}>
        <Link
          href={hrefFor(addMonths(month, -1), slug)}
          className={s.monthBtn}
          aria-label="Mês anterior"
        >
          ‹
        </Link>
        <Link
          href={hrefFor(addMonths(month, 1), slug)}
          className={s.monthBtn}
          aria-label="Próximo mês"
        >
          ›
        </Link>
      </div>
    </div>
  );
}

/**
 * Ocultar valores.
 *
 * Marca o <html> e o CSS faz o resto — instantaneo, sem ida ao servidor.
 * A mascara e' COSMETICA por decisao do dono: o valor real continua no HTML.
 */
export function PrivacyToggle() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    setHidden(document.documentElement.dataset.hideValues === "true");
  }, []);

  function toggle() {
    const next = !hidden;
    setHidden(next);
    document.documentElement.dataset.hideValues = String(next);
    try {
      localStorage.setItem(HIDE_KEY, String(next));
    } catch {
      // Modo privativo pode bloquear. O toggle continua funcionando na sessao.
    }
  }

  return (
    <button type="button" className={s.headerButton} onClick={toggle} aria-pressed={hidden}>
      {hidden ? "Mostrar valores" : "Ocultar valores"}
    </button>
  );
}

/** Busca. Escreve na URL com debounce; a filtragem acontece no servidor. */
export function SearchBox() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");

  useEffect(() => {
    const id = setTimeout(() => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set("q", value);
      else next.delete("q");
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    }, 250);
    return () => clearTimeout(id);
    // `params` muda a cada navegacao; incluir causaria loop.
  }, [value, pathname, router, params.toString]);

  return (
    <div className={s.searchBox}>
      <span className={s.searchIcon} aria-hidden="true" />
      <input
        type="search"
        className={s.searchInput}
        placeholder="Buscar lançamento, categoria…"
        aria-label="Buscar lançamento ou categoria"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  );
}

/** Titulo e subtitulo mudam por aba; o layout nao sabe qual e'. */
export function HeaderTitle({ month }: { month: RefMonth }) {
  const pathname = usePathname();
  const slug = slugFromPathname(pathname);
  const entry = NAV.find((e) => e.slug === slug) ?? NAV[0];
  if (!entry) return null;

  return (
    <div>
      <h1 className={s.headerTitle}>{entry.title(month, monthLabel(month))}</h1>
      <p className={s.headerSub}>{entry.subtitle}</p>
    </div>
  );
}

/**
 * Restaura a preferencia antes da primeira pintura.
 *
 * Sem isto os valores aparecem por um instante antes de serem ocultados — e'
 * exatamente o que o usuario nao quer de um toggle de privacidade.
 */
export function HidePreferenceScript() {
  const code = `try{if(localStorage.getItem(${JSON.stringify(HIDE_KEY)})==="true"){document.documentElement.dataset.hideValues="true"}}catch(e){}`;
  // biome-ignore lint/security/noDangerouslySetInnerHtml: script estatico e literal, sem entrada externa
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

export { refMonth };
