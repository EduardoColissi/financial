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
| `pnpm verify` | `typecheck` + `lint` + testes unitários |
| `pnpm e2e` | Playwright (sobe o próprio servidor na 3006 e refaz o seed) |
| `pnpm db:migrate` / `db:seed` / `db:reset` | schema e dados |
| `pnpm db:clear-attempts` | destrava o login depois de 5 tentativas erradas (só local) |
| `pnpm auth:hash` | gera `APP_PASSWORD_HASH` e `AUTH_SECRET` (interativo) |

## Acesso

O painel fica numa URL pública, então **toda** rota — página e API — exige sessão.
Duas camadas, de propósito:

1. `src/proxy.ts` (o antigo `middleware.ts`) filtra na borda. O matcher **precisa**
   cobrir `/api/*`; deixar `api` de fora é o erro clássico, e há um spec E2E que
   falha se alguém afrouxar.
2. `requireSession()` dentro de `getContext()` e de cada action. Não é redundância:
   Server Actions são POST na rota onde foram usadas, então um refactor de rota pode
   tirar a cobertura do proxy sem aviso — e middleware do Next já teve bypass por
   header (CVE-2025-29927).

Sessão é cookie assinado com HMAC-SHA256 (`AUTH_SECRET`), sem tabela. Não há como
revogar uma sessão isolada; trocar o `AUTH_SECRET` derruba todas — que é a operação
que importa aqui.

**Riscos aceitos, ditos em voz alta:** sem segundo fator; quem tem a passphrase vê
tudo; quem acessa o dashboard da Vercel lê o `AUTH_SECRET` e forja um cookie. É
proporcional a um painel pessoal. O inaceitável seria confiar na *Vercel
Authentication* achando que ela protege produção — ela só protege previews.

## Deploy

**Ordem obrigatória. Fora dela, um preview roda migration no banco de produção.**

1. **Neon** — projeto em `sa-east-1`, branch `main` (produção) e branch `dev`
   (previews). Regra dura: **nenhuma env de Preview aponta para `main`.** Configure
   isso *antes* do primeiro preview deploy.
2. **Branch de backup** antes de tocar em `main`:
   `backup-AAAA-MM-DD` (copy-on-write, instantânea). O restore do plano free cobre
   só 6 horas — sem o branch, uma migration destrutiva não tem volta.
3. **Migrations rodam da sua máquina**, apontando para a branch alvo:
   `pnpm db:migrate`. Nunca no build da Vercel — o build roda em todo preview.
4. **Variáveis na Vercel**, nos três ambientes. `AUTH_SECRET` **diferente por
   ambiente**, senão um cookie de preview abre produção:

   | Variável | Production | Preview | Observação |
   |---|---|---|---|
   | `DATABASE_URL` | pooler da branch `main` | pooler da branch `dev` | **sem ela o build falha**, não só o runtime |
   | `AUTH_SECRET` | valor A | valor B | 32 bytes, distintos |
   | `APP_PASSWORD_HASH` | `pnpm auth:hash` | idem | a senha em claro nunca sai da sua máquina |
   | `CRON_SECRET` | gerado pela Vercel | — | sem ele `/api/cron/daily` recusa tudo |
   | `APP_TIMEZONE` | `America/Sao_Paulo` | idem | tem default; declarar é explicitação |
   | `SESSION_MAX_AGE_DAYS` | opcional | opcional | default 30 |
   | `SINGLE_USER_ID` | opcional | opcional | sem ela, o login usa o primeiro usuário — que é o único |

   Não declare na Vercel: `DATABASE_URL_UNPOOLED` (só os scripts de migration a
   usam, e eles rodam da sua máquina) nem `APP_FAKE_TODAY` (ignorada em produção).

   **`DATABASE_URL` é lida no build.** O `next build` importa cada rota para
   coletar a configuração, e `lib/env.ts` valida o ambiente no import — sem ela o
   deploy morre em `Failed to collect page data for /[month]`, que não cita a
   variável. Declarar uma variável **com valor vazio** equivale a declarar `""`,
   não a omitir; `withoutBlanks` trata isso, mas o hábito seguro é não criar a
   linha.

5. **Vercel Authentication ligada** — protege os previews (produção continua
   pública; quem protege ela é o gate acima).
6. **Cron** — `vercel.json` já declara `/api/cron/daily` às 06:00 UTC (03:00 BRT).
   O Hobby permite um por dia; a materialização de mês é preguiçosa e idempotente,
   então o cron é cinto de segurança, não dependência.
7. **Smoke em produção**, nesta ordem:
   - URL sem cookie → 307 para `/login`
   - `GET /api/qualquer` sem cookie → **401 JSON**, não 200 e não HTML
   - login entra; as sete abas carregam com dado
   - navegação de mês muda a URL
   - `robots.txt` responde `Disallow: /`

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
