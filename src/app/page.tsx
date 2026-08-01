import { redirect } from "next/navigation";
import { monthOf } from "@/domain/period";
import { getContext } from "@/services/context";

/**
 * A raiz nao tem conteudo proprio: manda para o mes corrente.
 *
 * O mes vive na URL, entao `/` precisa resolver qual e' "agora" — e "agora"
 * depende do fuso do usuario, nunca do relogio do servidor (que na Vercel e'
 * UTC).
 */
export default async function Home() {
  const ctx = await getContext();
  redirect(`/${monthOf(ctx.today)}`);
}
