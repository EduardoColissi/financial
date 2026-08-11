/**
 * O que da' para mexer num lancamento ja' gravado.
 *
 * Nem todo lancamento e' uma linha solta. Tres deles sao a QUITACAO de outra
 * coisa — a conta a pagar, a fatura do cartao, o aporte do mes — e nesses o
 * numero na tela e' consequencia, nao causa. Editar o valor de um deles sem
 * mexer no que ele quita produz duas verdades diferentes para o mesmo dinheiro:
 * a conta continua dizendo R$ 300 e o caixa registra que sairam R$ 250.
 *
 * Por isso o escopo da edicao e' derivado do que aponta para o lancamento, e nao
 * uma escolha da tela. A tela esconde os campos; o servico tambem os ignora.
 *
 * O aporte NAO esta' nesta lista, e ja' esteve. Ele saiu quando o setor virou
 * coluna do proprio lancamento: sem uma segunda copia do valor para desencontrar,
 * ele voltou a ser linha solta — editar o valor corrige o setor no mesmo ato.
 */

/** O que, alem da propria linha, depende deste lancamento. */
export type EntryLink =
  /** Linha solta: ninguem aponta para ela. */
  | { kind: "none" }
  /**
   * Nasceu de uma cobranca de regra. Sao dois casos com desfecho oposto:
   *
   * - em conta (`onCard: false`), o lancamento e' a QUITACAO da cobranca, e
   *   apagar devolve ela para o aberto;
   * - no cartao (`onCard: true`), ele e' a cobranca CAINDO na fatura — ninguem
   *   pagou nada ainda —, e apagar significa "esta cobranca nao aconteceu":
   *   ela sai da fatura e o mes fica pulado.
   */
  | { kind: "charge"; label: string; onCard: boolean }
  /** Paga uma fatura. Apagar reabre a fatura E as cobrancas dentro dela. */
  | { kind: "statement"; label: string; charges: number };

export type EditableField = "description" | "amount" | "occurredOn" | "category" | "target";

const TODOS: readonly EditableField[] = [
  "description",
  "amount",
  "occurredOn",
  "category",
  "target",
];

/**
 * Campos que a edicao pode tocar.
 *
 * Quitacao nao troca de categoria nem de conta: os dois vem da regra ou da
 * fatura, e mudar so' aqui faria a cobranca e o lancamento discordarem no mes
 * seguinte, quando a regra gerar a proxima ocorrencia com a categoria antiga.
 *
 * Aporte nao troca de valor: quem manda no numero e' a soma dos setores. Mudar
 * so' o lancamento faria "aportado no mes" e "acumulado nos setores" divergirem
 * — e a divergencia so' apareceria meses depois, na meta da reserva.
 */
export function editableFields(link: EntryLink): readonly EditableField[] {
  switch (link.kind) {
    case "none":
      return TODOS;
    case "charge":
    case "statement":
      return ["description", "amount", "occurredOn"];
  }
}

export function canEdit(link: EntryLink, campo: EditableField): boolean {
  return editableFields(link).includes(campo);
}

/**
 * O que a exclusao desfaz, alem de apagar a linha.
 *
 * Existe pela mesma razao do banner de exclusao dos cadastros: dizer o estrago
 * em vez de perguntar "tem certeza?". Aqui o estrago costuma ser o oposto do
 * esperado — apagar o pagamento nao apaga a conta, ele a DESTRAVA de volta para
 * o aberto, e o dinheiro volta para o caixa.
 */
export function deleteEffect(link: EntryLink): string | null {
  switch (link.kind) {
    case "none":
      return null;
    case "charge":
      // No cartao nao ha' pagamento para desfazer: o que se desfaz e' a propria
      // cobranca do mes. Dizer "volta para as contas a pagar" seria prometer uma
      // conta a pagar que nao existe — quem paga isto e' a fatura.
      return link.onCard
        ? `“${link.label}” sai desta fatura, e a cobrança deste mês fica marcada como pulada.`
        : `“${link.label}” volta para as contas a pagar, e o dinheiro volta para o caixa.`;
    case "statement":
      return link.charges > 0
        ? `A fatura ${link.label} volta a aberta, com ${link.charges === 1 ? "a cobrança que estava" : `as ${link.charges} cobranças que estavam`} dentro dela.`
        : `A fatura ${link.label} volta a aberta.`;
  }
}
