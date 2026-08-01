import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { readSession } from "@/services/auth";
import { LoginForm } from "./login.client";
import s from "./login.module.css";

export const metadata: Metadata = {
  title: "Entrar · Meu Caixa",
  robots: { index: false, follow: false },
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
  if (await readSession()) redirect("/");

  const query = await searchParams;
  const raw = query.de;
  const next = (Array.isArray(raw) ? raw[0] : raw) ?? "/";

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

        <LoginForm next={next} />

        <p className={s.note}>
          Painel de uso pessoal. Uma senha só, sem segundo fator — quem tem a passphrase vê tudo.
        </p>
      </main>
    </div>
  );
}
