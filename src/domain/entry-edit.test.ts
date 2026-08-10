import { describe, expect, it } from "vitest";
import { canEdit, deleteEffect, type EntryLink, editableFields } from "./entry-edit";

const SOLTO: EntryLink = { kind: "none" };
const COBRANCA: EntryLink = { kind: "charge", label: "Aluguel" };
const FATURA: EntryLink = { kind: "statement", label: "Nubank", charges: 3 };

describe("editableFields", () => {
  it("lancamento solto abre tudo", () => {
    expect(editableFields(SOLTO)).toEqual([
      "description",
      "amount",
      "occurredOn",
      "category",
      "target",
    ]);
  });

  // Categoria e conta vem da regra. Mudar so' no lancamento faria a proxima
  // ocorrencia nascer com a categoria antiga, e as duas discordariam para sempre.
  it("quitacao nao troca categoria nem conta", () => {
    for (const link of [COBRANCA, FATURA]) {
      expect(canEdit(link, "amount")).toBe(true);
      expect(canEdit(link, "occurredOn")).toBe(true);
      expect(canEdit(link, "category")).toBe(false);
      expect(canEdit(link, "target")).toBe(false);
    }
  });

  // O aporte foi um vinculo enquanto o valor vivia em duas tabelas. Hoje o setor
  // e' coluna do proprio lancamento, e ele voltou a ser linha solta.
  it("aporte e' linha solta, editavel por inteiro", () => {
    expect(editableFields(SOLTO)).toContain("amount");
    expect(canEdit(SOLTO, "category")).toBe(true);
  });

  it("descricao e data valem em todos", () => {
    for (const link of [SOLTO, COBRANCA, FATURA]) {
      expect(canEdit(link, "description")).toBe(true);
      expect(canEdit(link, "occurredOn")).toBe(true);
    }
  });
});

describe("deleteEffect", () => {
  it("lancamento solto nao desfaz nada", () => {
    expect(deleteEffect(SOLTO)).toBeNull();
  });

  // O aviso importa porque o efeito e' o contrario do que se espera: apagar o
  // pagamento nao apaga a conta, destrava ela de volta para o aberto.
  it("diz que a conta volta para o aberto", () => {
    expect(deleteEffect(COBRANCA)).toContain("volta para as contas a pagar");
  });

  it("conta as cobrancas que voltam com a fatura", () => {
    expect(deleteEffect(FATURA)).toContain("3 cobranças");
    expect(deleteEffect({ kind: "statement", label: "Nubank", charges: 1 })).toContain(
      "a cobrança que estava"
    );
    expect(deleteEffect({ kind: "statement", label: "Nubank", charges: 0 })).toBe(
      "A fatura Nubank volta a aberta."
    );
  });
});
