import localFont from "next/font/local";

/**
 * Fontes auto-hospedadas.
 *
 * O design carrega do Google via `<link>`. Nao replicamos isso por dois
 * motivos: `next/font/google` baixa no BUILD e quebra atras de proxy com TLS
 * interceptado (`SELF_SIGNED_CERT_IN_CHAIN` — ja' aconteceu em outro projeto
 * desta maquina), e o `<link>` troca isso por uma dependencia de rede em
 * runtime, com FOUT.
 *
 * Com os arquivos no repo nao ha' rede em lugar nenhum, e o `adjustFontFallback`
 * ajusta as metricas do fallback para reduzir o deslocamento de layout.
 */

export const sans = localFont({
  src: [
    { path: "./fonts/instrument-sans-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/instrument-sans-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/instrument-sans-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/instrument-sans-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

export const mono = localFont({
  src: [
    { path: "./fonts/ibm-plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/ibm-plex-mono-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/ibm-plex-mono-600.woff2", weight: "600", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
});
