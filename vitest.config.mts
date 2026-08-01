import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Os testes que importam sao os do dominio: regras de dinheiro, ciclo de fatura,
 * parcelamento e fluxo de caixa. Rodam em ambiente node, sem DOM.
 *
 * TZ=UTC de proposito: a Vercel roda em UTC e e' exatamente ai que os bugs de
 * fronteira de mes aparecem. Se o teste so passa em horario de Brasilia, ele
 * nao esta testando o que vai para producao.
 *
 * Extensao .mts (nao .ts) para o Vite carregar como ESM sem warning.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.test.ts"],
    env: {
      TZ: "UTC",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/domain/**/*.ts"],
      exclude: ["**/*.test.ts"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
  resolve: {
    alias: {
      // fileURLToPath, nao URL.pathname: no Windows o pathname vem como
      // "/C:/Users/..." e o alias nao resolve.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
