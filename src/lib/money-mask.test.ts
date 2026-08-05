import { describe, expect, it } from "vitest";
import { MAX_CENTS } from "@/domain/money";
import {
  centsFromDigits,
  digitsFromCents,
  MASK_MAX_DIGITS,
  maskBRL,
  onlyDigits,
} from "./money-mask";

/** Simula digitar tecla a tecla num campo que ja' tem o texto mascarado. */
function digitar(teclas: string): string {
  let digitos = "";
  for (const t of teclas) digitos = onlyDigits(maskBRL(digitos) + t);
  return maskBRL(digitos);
}

describe("onlyDigits", () => {
  it("descarta tudo que nao e' digito", () => {
    expect(onlyDigits("R$ 1.234,56")).toBe("123456");
    expect(onlyDigits("abc")).toBe("");
  });

  it("come zeros a' esquerda mas preserva o zero sozinho", () => {
    expect(onlyDigits("0001")).toBe("1");
    expect(onlyDigits("0")).toBe("0");
  });

  it("para no teto de digitos", () => {
    expect(onlyDigits("9".repeat(20))).toHaveLength(MASK_MAX_DIGITS);
  });
});

describe("maskBRL", () => {
  it("enche pela direita", () => {
    expect(maskBRL("1")).toBe("0,01");
    expect(maskBRL("12")).toBe("0,12");
    expect(maskBRL("1234")).toBe("12,34");
    expect(maskBRL("123456789")).toBe("1.234.567,89");
  });

  it("vazio continua vazio, para o placeholder aparecer", () => {
    expect(maskBRL("")).toBe("");
  });
});

describe("digitando de verdade", () => {
  it("cada tecla empurra o numero uma casa para a esquerda", () => {
    expect(digitar("1")).toBe("0,01");
    expect(digitar("12")).toBe("0,12");
    expect(digitar("125")).toBe("1,25");
    expect(digitar("129990")).toBe("1.299,90");
  });

  // Sem isto, o "." que a mascara acabou de inserir voltaria como digito e o
  // valor cresceria sozinho a cada tecla.
  it("o separador que a mascara inseriu nao vira digito", () => {
    expect(digitar("1234567")).toBe("12.345,67");
  });

  it("apagar tudo devolve o campo vazio", () => {
    expect(onlyDigits("")).toBe("");
    expect(maskBRL(onlyDigits(""))).toBe("");
  });
});

describe("ida e volta com centavos", () => {
  it("digitos sao centavos, sem float no meio", () => {
    expect(centsFromDigits("1999")).toBe(1999);
    expect(centsFromDigits("")).toBe(0);
  });

  it("centavos viram os mesmos digitos de volta", () => {
    expect(digitsFromCents(1999)).toBe("1999");
    expect(maskBRL(digitsFromCents(1999))).toBe("19,99");
  });

  it("campo sem valor fica vazio, nao zerado", () => {
    expect(digitsFromCents(null)).toBe("");
    expect(digitsFromCents(undefined)).toBe("");
  });

  // O teto do campo tem que caber no teto do dominio: se nao coubesse, daria
  // para digitar um numero que `cents()` recusa so' na hora de salvar.
  it("o maior valor digitavel ainda e' aceito pelo dominio", () => {
    const maximo = centsFromDigits("9".repeat(MASK_MAX_DIGITS));
    expect(maximo).toBeLessThanOrEqual(MAX_CENTS);
  });
});
