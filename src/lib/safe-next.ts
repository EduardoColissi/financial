/**
 * Destino de redirecionamento pos-login.
 *
 * Sem esta checagem, `/login?de=https://outro.site` transformaria a tela de
 * entrada num redirecionador aberto — o padrao usado para dar aparencia
 * legitima a link de phishing: o dominio na barra e' o seu, e o clique leva
 * para outro lugar.
 *
 * Mora fora do arquivo `"use server"` de proposito: modulo de action so' pode
 * exportar funcao assincrona, e esta precisa ser testavel como funcao pura.
 */
export function safeNext(raw: string | undefined | null): string {
  if (!raw?.startsWith("/")) return "/";
  // `//host` e `/\host` sao endereco de OUTRO host, nao caminho interno.
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  // Alguns navegadores normalizam a barra invertida para barra.
  if (raw.includes("\\")) return "/";
  return raw;
}
