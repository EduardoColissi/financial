import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { nowInstant } from "@/domain/period";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Camada 1 do gate de acesso.
 *
 * No Next 16 o `middleware.ts` virou `proxy.ts` e passou a rodar no runtime
 * Node por padrao — e' o que permite verificar o HMAC com `node:crypto` aqui.
 *
 * Isto NAO e' a fronteira de autorizacao, e' um filtro barato na borda. A
 * fronteira de verdade e' `requireSession()`, chamada dentro de cada leitura,
 * action e route handler. Middleware do Next ja' teve bypass por header
 * (CVE-2025-29927), e Server Functions sao POST na rota onde foram usadas —
 * mexer no matcher pode tirar a cobertura daqui sem ninguem perceber.
 */

/**
 * Casa com tudo, inclusive `/api/*`.
 *
 * Deixar `api` de fora do matcher e' o erro classico: as paginas ficam
 * protegidas, e o JSON com o extrato inteiro responde 200 para qualquer um.
 * So' os assets estaticos, que nao carregam dado, ficam de fora.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

/** Rotas que precisam responder sem sessao — e por que. */
function isPublic(pathname: string): boolean {
  // A tela de entrada, senao o redirect vira loop.
  if (pathname === "/login") return true;
  // Ida e volta do OAuth. Quem esta' entrando ainda nao tem sessao — exigir uma
  // aqui tornaria o login impossivel. O que protege estas duas rotas e' o
  // `state` assinado no cookie do vaivem, nao o gate.
  if (pathname.startsWith("/api/auth/google")) return true;
  // Um crawler precisa conseguir ler o proprio "nao me indexe".
  if (pathname === "/robots.txt") return true;
  // Cron da Vercel nao tem cookie; ele se autentica com CRON_SECRET no handler.
  if (pathname.startsWith("/api/cron/")) return true;
  return false;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, nowInstant());
  if (session) return NextResponse.next();

  // API responde 401 em JSON. Devolver o HTML do login para um fetch faria o
  // cliente tentar interpretar uma pagina como dados — falha confusa e tardia.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Cookie ausente, adulterado ou vencido caem todos aqui. Como /login e'
  // publico, nao ha' como entrar em loop de redirect.
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const from = `${pathname}${search}`;
  if (from !== "/") url.searchParams.set("de", from);
  return NextResponse.redirect(url, 307);
}
