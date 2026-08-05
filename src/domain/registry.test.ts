import { describe, expect, it } from "vitest";
import {
  daysOfFloat,
  initialsFrom,
  PALETTE,
  parseAccountForm,
  parseCardForm,
  parseCategoryForm,
  RegistryError,
} from "./registry";

const COR = PALETTE[0];

/** Formulario de conta valido. Cada teste estraga um campo. */
const conta = (extra: Record<string, string | undefined> = {}) => ({
  name: "Sicoob",
  type: "checking",
  color: COR,
  ...extra,
});

const cartao = (extra: Record<string, string | undefined> = {}) => ({
  name: "Nubank Edu",
  brand: "Mastercard",
  color: COR,
  closingDay: "28",
  dueDay: "5",
  ...extra,
});

/** O campo que falhou importa tanto quanto a recusa: e' o que a UI destaca. */
function campoQueFalhou(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof RegistryError) return e.field;
    throw e;
  }
  throw new Error("esperava RegistryError, nao houve");
}

describe("initialsFrom", () => {
  it("usa as duas primeiras letras da primeira palavra", () => {
    expect(initialsFrom("Nubank · Conta")).toBe("NU");
    expect(initialsFrom("Sicoob")).toBe("SI");
  });

  it("ignora separadores no comeco", () => {
    expect(initialsFrom("· Itaú")).toBe("IT");
  });

  it("aceita nome de uma letra so", () => {
    expect(initialsFrom("C")).toBe("C");
  });

  it("nao quebra com nome sem letra nem numero", () => {
    expect(initialsFrom("···")).toBe("??");
    expect(initialsFrom("   ")).toBe("??");
  });
});

describe("parseAccountForm", () => {
  it("aceita o minimo e deriva as iniciais", () => {
    const d = parseAccountForm(conta());
    expect(d.name).toBe("Sicoob");
    expect(d.initials).toBe("SI");
    expect(d.holder).toBeNull();
    expect(d.tag).toBeNull();
  });

  it("normaliza espaco repetido no nome", () => {
    expect(parseAccountForm(conta({ name: "  Banco   do  Brasil " })).name).toBe("Banco do Brasil");
  });

  it("respeita iniciais digitadas, em maiuscula", () => {
    expect(parseAccountForm(conta({ initials: "nu" })).initials).toBe("NU");
  });

  /**
   * Corretora fora do caixa por padrao: o valor investido nao e' dinheiro
   * disponivel, e soma-lo inflaria a sobra do mes.
   */
  it("deixa corretora fora do caixa por padrao", () => {
    expect(parseAccountForm(conta({ type: "brokerage" })).includeInCashTotal).toBe(false);
    expect(parseAccountForm(conta({ type: "checking" })).includeInCashTotal).toBe(true);
  });

  it("respeita a marcacao explicita do caixa", () => {
    expect(
      parseAccountForm(conta({ type: "brokerage", includeInCashTotal: "on" })).includeInCashTotal
    ).toBe(true);
  });

  it("recusa nome vazio", () => {
    expect(campoQueFalhou(() => parseAccountForm(conta({ name: "  " })))).toBe("name");
  });

  it("recusa nome longo demais", () => {
    expect(campoQueFalhou(() => parseAccountForm(conta({ name: "x".repeat(41) })))).toBe("name");
  });

  it("recusa tipo fora do enum", () => {
    expect(campoQueFalhou(() => parseAccountForm(conta({ type: "poupanca" })))).toBe("type");
  });

  it("aceita cor livre do seletor, em hex", () => {
    expect(parseAccountForm(conta({ color: "#a1b2c3" })).color).toBe("#a1b2c3");
    // O seletor nativo devolve maiusculas em alguns navegadores.
    expect(parseAccountForm(conta({ color: "#A1B2C3" })).color).toBe("#a1b2c3");
  });

  /**
   * A cor vai para um atributo `style`. Sem esta checagem, um POST fabricado
   * grava CSS arbitrario que a tela renderiza — o hex livre nao afrouxa isso,
   * porque a regex nao deixa passar parentese, espaco nem barra.
   */
  it("recusa qualquer coisa que nao seja preset nem hex de 6 digitos", () => {
    const recusa = (color: string) =>
      expect(campoQueFalhou(() => parseAccountForm(conta({ color })))).toBe("color");

    recusa("red");
    recusa("#fff"); // hex curto nao entra: so' a forma de 6 digitos
    recusa("#gggggg");
    recusa("url(javascript:alert(1))");
    recusa("#a1b2c3; background: url(https://exfil.example)");
    recusa("oklch(0.5 0.5 0)"); // oklch valido, mas fora da paleta
  });

  it("recusa etiqueta e titular longos demais", () => {
    expect(campoQueFalhou(() => parseAccountForm(conta({ tag: "x".repeat(31) })))).toBe("tag");
    expect(campoQueFalhou(() => parseAccountForm(conta({ holder: "x".repeat(31) })))).toBe(
      "holder"
    );
  });
});

describe("parseCardForm", () => {
  it("aceita o minimo", () => {
    const d = parseCardForm(cartao());
    expect(d.name).toBe("Nubank Edu");
    expect(d.closingDay).toBe(28);
    expect(d.dueDay).toBe(5);
    expect(d.limitCents).toBe(0);
    expect(d.lastFour).toBeNull();
  });

  it("le limite em pt-BR", () => {
    expect(parseCardForm(cartao({ limit: "12.000,00" })).limitCents).toBe(1200000);
  });

  it("recusa limite negativo", () => {
    expect(campoQueFalhou(() => parseCardForm(cartao({ limit: "-1,00" })))).toBe("limit");
  });

  it("aceita os quatro digitos finais", () => {
    expect(parseCardForm(cartao({ lastFour: "1234" })).lastFour).toBe("1234");
  });

  it("recusa final que nao tem 4 digitos", () => {
    expect(campoQueFalhou(() => parseCardForm(cartao({ lastFour: "12" })))).toBe("lastFour");
    expect(campoQueFalhou(() => parseCardForm(cartao({ lastFour: "abcd" })))).toBe("lastFour");
  });

  it("recusa dia fora de 1..31", () => {
    expect(campoQueFalhou(() => parseCardForm(cartao({ closingDay: "0" })))).toBe("closingDay");
    expect(campoQueFalhou(() => parseCardForm(cartao({ dueDay: "32" })))).toBe("dueDay");
    expect(campoQueFalhou(() => parseCardForm(cartao({ closingDay: "1,5" })))).toBe("closingDay");
    expect(campoQueFalhou(() => parseCardForm(cartao({ dueDay: "" })))).toBe("dueDay");
  });

  it("recusa nome e bandeira vazios", () => {
    expect(campoQueFalhou(() => parseCardForm(cartao({ name: "" })))).toBe("name");
    expect(campoQueFalhou(() => parseCardForm(cartao({ brand: " " })))).toBe("brand");
  });

  // O cartao nao tem conta de pagamento: a fatura sai do caixa inteiro. Ver o
  // comentario em `db/schema/core.ts`, onde a coluna vivia.
  it("ignora conta de pagamento vinda de formulario antigo", () => {
    const d = parseCardForm(cartao({ defaultPaymentAccountId: "0b2f6a7e-1c2d-4e5f-8a9b-0c1d2e" }));
    expect(d).not.toHaveProperty("defaultPaymentAccountId");
  });
});

describe("parseCategoryForm", () => {
  const categoria = (extra: Record<string, string | undefined> = {}) => ({
    name: "Alimentação",
    kind: "expense",
    color: COR,
    ...extra,
  });

  it("aceita gasto com orcamento", () => {
    const d = parseCategoryForm(categoria({ budget: "1.400,00" }));
    expect(d.name).toBe("Alimentação");
    expect(d.kind).toBe("expense");
    expect(d.monthlyBudgetCents).toBe(140000);
  });

  it("aceita gasto sem orcamento", () => {
    expect(parseCategoryForm(categoria()).monthlyBudgetCents).toBeNull();
  });

  it("aceita receita", () => {
    const d = parseCategoryForm(categoria({ name: "Salário Edu", kind: "income" }));
    expect(d.kind).toBe("income");
    expect(d.monthlyBudgetCents).toBeNull();
  });

  // Categoria de aporte saiu: o destino de um aporte e' um SETOR de
  // investimento. Um formulario antigo com `kind=investment` tem que ser
  // recusado, nao gravado num tipo que a tela nao sabe mais desenhar.
  it("recusa aporte, que agora e' setor", () => {
    expect(campoQueFalhou(() => parseCategoryForm(categoria({ kind: "investment" })))).toBe("kind");
  });

  /**
   * Orcar receita nao quer dizer nada. O valor e' DESCARTADO em vez de recusado:
   * o usuario pode ter digitado antes de trocar o tipo, e perder o formulario
   * inteiro por isso seria hostil.
   */
  it("descarta orcamento em receita, sem reclamar", () => {
    const d = parseCategoryForm(categoria({ kind: "income", budget: "1.000,00" }));
    expect(d.monthlyBudgetCents).toBeNull();
  });

  it("recusa nome vazio", () => {
    expect(campoQueFalhou(() => parseCategoryForm(categoria({ name: " " })))).toBe("name");
  });

  it("recusa tipo fora do enum", () => {
    expect(campoQueFalhou(() => parseCategoryForm(categoria({ kind: "outro" })))).toBe("kind");
  });

  it("aceita hex livre e recusa hex curto", () => {
    expect(parseCategoryForm(categoria({ color: "#a1b2c3" })).color).toBe("#a1b2c3");
    expect(campoQueFalhou(() => parseCategoryForm(categoria({ color: "#fff" })))).toBe("color");
  });

  it("recusa orcamento negativo", () => {
    expect(campoQueFalhou(() => parseCategoryForm(categoria({ budget: "-10,00" })))).toBe("budget");
  });

  it("recusa orcamento que nao e numero", () => {
    expect(campoQueFalhou(() => parseCategoryForm(categoria({ budget: "abc" })))).toBe("budget");
  });
});

/**
 * O prazo denuncia fechamento e vencimento trocados — o engano mais caro deste
 * formulario, porque contamina meses de fatura antes de alguem perceber.
 */
describe("daysOfFloat", () => {
  it("conta ate o vencimento do mes seguinte", () => {
    // Fecha dia 28, vence dia 5: 7 dias de virada + 30.
    expect(daysOfFloat(28, 5)).toBe(37);
  });

  it("conta dentro do mesmo mes quando o vencimento vem depois", () => {
    expect(daysOfFloat(2, 10)).toBe(38);
  });

  it("nunca devolve prazo negativo", () => {
    for (let fecha = 1; fecha <= 31; fecha++) {
      for (let vence = 1; vence <= 31; vence++) {
        expect(daysOfFloat(fecha, vence)).toBeGreaterThan(0);
      }
    }
  });
});
