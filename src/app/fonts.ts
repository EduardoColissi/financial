import localFont from "next/font/local";

/**
 * Fontes auto-hospedadas.
 *
 * O design carrega do Google via `<link>`. Nao replicamos isso por dois
 * motivos: `next/font/google` baixa no BUILD e quebra atras de proxy com TLS
 * interceptado (`SELF_SIGNED_CERT_IN_CHAIN` — ja' aconteceu em outro projeto
 * desta maquina), e o `<link>` troca isso por uma dependencia de rede em
 * runtime, com FOUT. Com os arquivos no repo nao ha' rede em lugar nenhum.
 *
 * Sao arquivos VARIAVEIS: um por familia cobre toda a faixa de peso.
 * Substituiram sete estaticos (163 KB) por dois (88 KB), e qualquer peso
 * intermediario passa a existir sem download novo.
 *
 * O par do design (Instrument Sans + IBM Plex Mono) foi trocado a pedido do
 * dono. Inter e JetBrains Mono sao deliberadamente neutras: num painel de
 * financas quem precisa chamar atencao e' o numero, nao a letra.
 */

export const sans = localFont({
  src: [{ path: "./fonts/inter-variable.woff2", weight: "100 900", style: "normal" }],
  variable: "--font-sans",
  display: "swap",
  fallback: ["system-ui", "-apple-system", "Segoe UI", "sans-serif"],
});

/**
 * JetBrains Mono tem a mesma largura de avanco do IBM Plex Mono (600/1000 em),
 * entao a tabela de oito colunas e as celulas do calendario nao mudam de medida
 * com a troca — so' o desenho da letra muda.
 */
export const mono = localFont({
  src: [{ path: "./fonts/jetbrains-mono-variable.woff2", weight: "100 800", style: "normal" }],
  variable: "--font-mono",
  display: "swap",
  fallback: ["ui-monospace", "SFMono-Regular", "Consolas", "monospace"],
});
