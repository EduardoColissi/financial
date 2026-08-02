/**
 * Normaliza o ambiente cru antes da validacao.
 *
 * O dashboard da Vercel aceita variavel com valor vazio, e o runbook de deploy
 * manda declarar `APP_FAKE_TODAY` vazia em producao. Vazia nao vira `undefined`
 * no processo: vira `""` — e `""` nao passa em `min(1)`, `uuid()` nem no regex
 * de data. O build quebra em "Failed to collect page data", sem citar a
 * variavel, num deploy onde ninguem mexeu em codigo.
 *
 * Tratar `""` como ausente e' o que qualquer um espera de uma variavel opcional
 * "deixada em branco". Mora fora de `env.ts` para poder ser testada como funcao
 * pura — `env.ts` valida no import e nao sobrevive a um teste sem banco.
 */
type RawEnv = Record<string, string | undefined>;

export function withoutBlanks(raw: RawEnv): RawEnv {
  const out: RawEnv = {};
  for (const [key, value] of Object.entries(raw)) {
    // Espaco em branco tambem: colar um valor no dashboard e apagar deixa " ".
    if (value !== undefined && value.trim() === "") continue;
    out[key] = value;
  }
  return out;
}
