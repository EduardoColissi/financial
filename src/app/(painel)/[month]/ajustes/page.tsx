import { notFound } from "next/navigation";
import { parseMonthParam } from "@/domain/period";
import { Registry } from "@/features/ajustes/Registry.client";
import { getContext } from "@/services/context";
import {
  accountImpacts,
  cardImpacts,
  categoryImpacts,
  listAccounts,
  listCards,
  listCategories,
  listHolders,
  listRecurring,
  recurringImpacts,
} from "@/services/registry";

/**
 * Cadastro de contas e cartoes.
 *
 * Fica sob `/[month]/` para herdar o shell, mas nao le' o mes para nada: conta e
 * cartao existem fora do calendario. O parse do segmento continua aqui so' para
 * um mes invalido na URL dar 404 igual as outras abas, em vez de renderizar uma
 * pagina valida sob um endereco que nao e'.
 */
export default async function AjustesPage({ params }: { params: Promise<{ month: string }> }) {
  const { month: raw } = await params;
  if (!parseMonthParam(raw)) notFound();

  const ctx = await getContext();
  // Os impactos descem junto com as listas: a confirmacao de exclusao precisa
  // dizer QUANTOS lancamentos vao junto, e buscar isso no clique deixaria o
  // botao mudo enquanto a resposta nao chega.
  const [
    contas,
    cartoes,
    categorias,
    regras,
    titulares,
    impContas,
    impCartoes,
    impCategorias,
    impRegras,
  ] = await Promise.all([
    listAccounts(ctx),
    listCards(ctx),
    listCategories(ctx),
    listRecurring(ctx),
    listHolders(ctx),
    accountImpacts(ctx),
    cardImpacts(ctx),
    categoryImpacts(ctx),
    recurringImpacts(ctx),
  ]);

  return (
    <Registry
      contas={contas}
      cartoes={cartoes}
      categorias={categorias}
      regras={regras}
      titulares={titulares}
      mesCorrente={ctx.today.slice(0, 7)}
      // `Map` nao atravessa a fronteira servidor -> cliente; objeto simples, sim.
      impactosContas={Object.fromEntries(impContas)}
      impactosCartoes={Object.fromEntries(impCartoes)}
      impactosCategorias={Object.fromEntries(impCategorias)}
      impactosRegras={Object.fromEntries(impRegras)}
    />
  );
}
