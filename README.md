# Meu Caixa

Painel de finanças pessoais — controle de lançamentos, contas a pagar, cartões de crédito, categorias, assinaturas/parcelas e investimentos.

Uso pessoal, single-user.

## Stack

| Camada | Escolha |
|---|---|
| App | Next.js 16.2.12 (App Router) + React 19.2.4 + TypeScript 5.9 strict |
| Banco | Postgres — Neon em produção, container Podman em desenvolvimento |
| Driver | `pg` (node-postgres) — o mesmo local e em produção |
| ORM | Drizzle + drizzle-kit |
| Estilo | CSS Modules + design tokens em custom properties |
| Deploy | Vercel |

Decisões de arquitetura e o plano de implementação vivem no vault, em
`Cérebro SaaS/meu-caixa/`.

## Rodando localmente

Portas escolhidas para não colidir com outros projetos da máquina
(3000 e 5432 são usadas pelo `creator-flow` / `hub-ia`):

- app → **3005**
- Postgres → **5433**

### Primeira vez

```powershell
# 1. Banco local (volume NOMEADO — bind-mount NTFS quebra o Postgres)
podman run -d --name financial-postgres `
  -e POSTGRES_USER=financial -e POSTGRES_PASSWORD=financial -e POSTGRES_DB=financial `
  -p 5433:5432 -v financial-pgdata:/var/lib/postgresql/data `
  docker.io/library/postgres:17-alpine

# 2. Variáveis
Copy-Item .env.example .env.local   # e preencher

# 3. Dependências e schema
pnpm install
pnpm db:migrate
pnpm db:seed
```

### Dia a dia

```powershell
podman start financial-postgres
pnpm dev
```

Não use `podman compose` — nesta máquina ele cai no `docker-compose.exe` e exige daemon Docker.

## Scripts

| Script | O que faz |
|---|---|
| `pnpm dev` | desenvolvimento na porta 3005 |
| `pnpm build` | build de produção |
| `pnpm typecheck` | `tsc --noEmit` |

Os scripts de lint, teste e banco (`db:*`, `verify`, `auth:hash`) entram nos passos
seguintes do plano.

## Convenções

- **Dinheiro é `integer` em centavos.** Nenhum float representa valor monetário em
  lugar nenhum — nem no banco, nem no domínio, nem na UI. Colunas sempre sufixadas
  `_cents`.
- **`domain/` é puro**: não importa `db` nem `next`. É onde vivem as regras de
  dinheiro (ciclo de fatura, parcelamento, fluxo de caixa) e é o que tem cobertura
  de teste de verdade.
- **`new Date()` é proibido** fora de `domain/period.ts`. A Vercel roda em UTC e
  `new Date()` às 21h30 de Brasília no dia 31 devolve o dia 1 do mês seguinte.
- **Server Component é o default.** Client só em arquivos `*.client.tsx`.
- **Nenhum literal de cor fora de `styles/tokens.css`.**
- UI em português do Brasil, acentuada.

## Aviso sobre o Next.js desta versão

O Next 16 tem mudanças que contrariam o conhecimento de treino da maioria dos
modelos: `params` e `searchParams` são `Promise`, e `middleware.ts` passou a se
chamar `proxy.ts`. Antes de escrever código, consulte as docs empacotadas em
`node_modules/next/dist/docs/` — elas vencem qualquer outra referência.

## Design

O painel implementa o design `design/painel-financeiro-v2.html`, exportado do
Claude Design. Ele é a referência **visual**; várias das regras de negócio dele
estão erradas e as correções acordadas estão catalogadas no plano, no vault.
