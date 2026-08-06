import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { readLiveSession } from "@/services/auth";
import s from "./login.module.css";

export const metadata: Metadata = {
  title: "Entrar · Meu Caixa",
  robots: { index: false, follow: false },
};

/**
 * Traducao dos motivos de recusa.
 *
 * O painel e' de uma pessoa so', que tambem e' quem opera o servidor: dizer o
 * motivo exato aqui poupa uma ida ao log. Nao ha' o que vazar — sao estados de
 * configuracao e de recusa, e nenhum deles descreve outra conta.
 */
const MOTIVOS: Record<string, string> = {
  "not-configured":
    "Login com Google não configurado. Faltam GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_ALLOWED_EMAIL ou AUTH_SECRET.",
  "state-mismatch": "A tentativa expirou ou não confere. Clique de novo.",
  "exchange-failed":
    "O Google recusou a troca do código. Confira o client secret e o redirect URI.",
  malformed: "O Google respondeu num formato inesperado.",
  "wrong-issuer": "A resposta não veio do Google.",
  "wrong-audience": "A resposta do Google é de outro aplicativo OAuth.",
  expired: "A resposta do Google venceu. Clique de novo.",
  "nonce-mismatch": "A resposta não corresponde a esta tentativa. Clique de novo.",
  "email-unverified": "Essa conta Google está com o e-mail não verificado.",
  "email-not-allowed": "Essa conta Google não tem acesso a este painel.",
  "sub-mismatch": "O e-mail confere, mas é outra conta Google. Acesso recusado.",
  "no-user": "Acesso liberado, mas o banco não tem usuário. Rode `pnpm db:bootstrap`.",
  access_denied: "Entrada cancelada no Google.",
};

/**
 * Unica rota publica do app.
 *
 * Quem ja' tem sessao valida nao ve' esta tela: voltar ao login logado e'
 * confuso, e o botao voltar do navegador cairia aqui depois de entrar.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `readLiveSession`, e nao `readSession`: cookie bem assinado apontando para
  // usuario que nao existe mais devolveria o visitante para `/`, que o manda de
  // volta para ca' — laco infinito. Ver o comentario em `services/auth.ts`.
  if (await readLiveSession()) redirect("/");

  const query = await searchParams;
  const primeiro = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const next = safeNext(primeiro(query.de));
  const erro = primeiro(query.erro);
  const mensagem = erro ? (MOTIVOS[erro] ?? "Não foi possível entrar. Clique de novo.") : null;

  return (
    <div className={s.screen}>
      <div className={s.blobs} aria-hidden="true">
        <div className={`${s.blob} ${s.blobA}`} />
        <div className={`${s.blob} ${s.blobB}`} />
      </div>

      <main className={s.card}>
        <div className={s.brand}>
          <div className={s.mark} aria-hidden="true">
            ₲
          </div>
          <div>
            <span className={s.name}>Meu Caixa</span>
            <span className={s.sub}>finanças pessoais</span>
          </div>
        </div>

        {mensagem ? (
          <p className={s.error} role="alert">
            {mensagem}
          </p>
        ) : null}

        {/*
          Link, e nao <form>: o inicio do OAuth e' uma navegacao GET que grava o
          cookie do vaivem antes de sair do site. Sem estado no cliente, esta
          tela nao carrega JavaScript nenhum.
        */}
        <a className={s.google} href={`/api/auth/google?de=${encodeURIComponent(next)}`}>
          <GoogleMark />
          Entrar com Google
        </a>

        <p className={s.note}>
          Painel de uso pessoal. Só uma conta Google entra — qualquer outra é recusada mesmo depois
          de autenticar.
        </p>
      </main>
    </div>
  );
}

/** Logotipo oficial, nas quatro cores. Inline para nao depender de rede. */
function GoogleMark() {
  return (
    <svg className={s.googleMark} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}
