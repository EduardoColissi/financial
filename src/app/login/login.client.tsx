"use client";

import { useActionState } from "react";
import { type LoginState, loginAction } from "@/app/actions/auth";
import s from "./login.module.css";

const INITIAL: LoginState = {};

/**
 * Formulario de entrada.
 *
 * A unica coisa que precisa do cliente e' o estado de "entrando…". A senha em
 * si nunca fica em `useState`: vai direto do <input> para o FormData e da' para
 * a Server Action, sem passar por variavel do React.
 */
export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <form action={formAction} className={s.form}>
      <input type="hidden" name="de" value={next} />

      <label className={s.label} htmlFor="passphrase">
        Passphrase
      </label>
      <input
        id="passphrase"
        name="passphrase"
        type="password"
        className={s.input}
        autoComplete="current-password"
        // biome-ignore lint/a11y/noAutofocus: unico campo da unica tela publica
        autoFocus
        required
      />

      {state.error ? (
        <p className={s.error} role="alert">
          {state.error}
        </p>
      ) : null}

      <button type="submit" className={s.submit} disabled={pending}>
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
