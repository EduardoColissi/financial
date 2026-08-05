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

**Cliente OAuth do Google** (passo 2, sem ele não há como entrar) — em
[console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials):
*Create Credentials* → *OAuth client ID* → **Web application**. Em *Authorized
redirect URIs*, exatamente:

```
http://localhost:3005/api/auth/google/callback
```

Copie o Client ID e o Client secret para `GOOGLE_CLIENT_ID` e
`GOOGLE_CLIENT_SECRET`, e ponha seu endereço em `GOOGLE_ALLOWED_EMAIL` — é a
única conta que entra. Se a tela de consentimento pedir modo de publicação,
*Testing* com você como usuário de teste basta: o app é de uma pessoa só.

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
| `pnpm db:bootstrap` | usuário + categorias, sem dados fabricados — é o que serve para produção |

### O usuário do seed é outro, de propósito

`pnpm db:seed` é destrutivo: apaga o usuário de `seed@meucaixa.local` — cascade
leva contas, cartões e lançamentos junto — e reconstrói os dados do design. E ele
roda **sozinho** dentro do `pnpm e2e`.

Esse endereço nunca pode ser o seu (`GOOGLE_ALLOWED_EMAIL`). Já esteve, e o
efeito foi o previsível: uma rodada de teste apagou uma conta cadastrada à mão e
derrubou a sessão. Pior, o sintoma não foi um erro — foi um laço de redirect,
porque o cookie continuava bem assinado apontando para um id que não existia
mais (há spec E2E cobrindo isso agora).

Os dois usuários convivem no mesmo banco local: o do seed serve à suíte, o seu
guarda o que você cadastra pela tela. `pnpm db:bootstrap --email=<o seu>` cria o
seu; o login te encontra por e-mail, ou por `SINGLE_USER_ID` se ela existir.

### "Hoje" vem do relógio, sempre

Não há variável de ambiente que congele a data. Houve — `APP_FAKE_TODAY`, para
comparar a tela com o design — e ela saiu: uma data injetável por ambiente é um
jeito de o app inteiro operar no dia errado sem ninguém notar.

O que substituiu: **o seed segue o relógio junto**. Ele se ancora no mês corrente
e deriva tudo daí — `firstMonthOffset` nas regras recorrentes, `monthOffset` no
histórico do gráfico. Por isso a parcela que o design mostra como "4 de 12"
continua sendo 4 de 12 em qualquer mês, e o painel abre num mês que tem dado.

Quem precisa de tempo determinístico injeta a data por parâmetro: todo serviço
recebe `today` do `AppContext`, nenhum lê o relógio por dentro. Os specs E2E
derivam o mês de `MES_CORRENTE` (`e2e/fixtures.ts`), calculado com a mesma função
da aplicação e no mesmo fuso — `new Date()` cru daria o mês errado na virada,
já que o CI roda em UTC.

## Os dois números do topo

O painel mostra **Em conta** e **Sobra** lado a lado. A diferença entre eles é o
ponto do produto:

```
EM CONTA = abertura + entradas − saídas JÁ pagas
SOBRA    = em conta − (não liquidados + contas abertas + faturas abertas)
```

**Em conta** é o dinheiro que existe agora. Compra no cartão não aparece aqui —
ela só toca o caixa quando a fatura é paga. **Sobra** é o saldo projetado do fim
do mês: já desconta tudo que ainda falta pagar.

Pagar uma conta derruba o primeiro e **não move** o segundo, porque o
compromisso já estava contado. Quando não há mais pendência, os dois coincidem.
Há spec E2E fixando essa invariante.

A regra vive em `domain/cash.ts` — pura, sem banco. A fronteira delicada é a
cobrança recorrente que cai em fatura: ela já está dentro do total do cartão, e
por isso `open_bills` exclui quem tem `statement_id`. Sem esse filtro, uma
assinatura no cartão seria contada duas vezes.

## Custo de vida e reserva

Cobrança marcada como **obrigatória** entra no custo de vida. A média corre
sobre os meses que já têm dado — no primeiro mês é o próprio mês, no segundo a
média dos dois — e a reserva de emergência é 6× essa média.

Mês sem conta obrigatória não entra na média: seria um zero sugerindo que se
vive de graça, e a meta nasceria curta.

## Investimentos: para onde vai o que sobra

Setores com fatia da sobra, objetivo e data-alvo. O que sobra no fim do mês vira
aporte, repartido por essas fatias — é o único caminho pelo qual dinheiro entra
ali.

Fatias que somam menos de 100% são respeitadas: 80% configurados significa que
20% da sobra fica em caixa. Normalizar seria decidir pelo dono. Acima de 100% o
app recusa gravar.

A reserva de emergência não digita meta: são 6× o custo de vida, e ela sobe
conforme você lança.

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

### Quem entra: uma conta Google, e só

O login é OAuth 2.0 Authorization Code + PKCE, **escrito à mão** em
`src/services/google-auth.ts`. Sem biblioteca de auth: o fluxo cabe num arquivo,
e a alternativa traria a própria camada de sessão competindo com a que já existe.

Autenticar no Google **não é** autorização. O callback só cria sessão se, na
ordem: o `state` bate com o cookie assinado do vaivém; o Google aceitou a troca
do código com o `code_verifier` do PKCE; o ID token é do emissor certo, para
**este** `client_id`, não vencido, e com o `nonce` desta tentativa; o e-mail está
verificado e é o `GOOGLE_ALLOWED_EMAIL`; e o `sub` bate com o gravado.

O `sub` é o que fecha a última brecha. O e-mail é a porta, não a fechadura: se um
dia for reatribuído a outra pessoa, ela passaria na allowlist e cairia na conta
com o histórico inteiro. No primeiro login o `sub` é gravado em `users.google_sub`
e exigido de todos os seguintes.

**A assinatura do ID token não é verificada** — de propósito. O token chega como
resposta direta do endpoint do Google, por TLS, e o OpenID Connect Core dispensa
a verificação nesse caso (§3.1.3.7); o canal já autentica o emissor. Isso vale
**só** aí: token que passa pelo navegador precisa de assinatura conferida, e é o
que o comentário em `google-identity.ts` grava para o próximo leitor.

**Riscos aceitos, ditos em voz alta:** quem controla a conta Google vê tudo (então
ligue 2FA nela — é lá que mora o segundo fator agora); quem acessa o dashboard da
Vercel lê o `AUTH_SECRET` e forja um cookie. É proporcional a um painel pessoal. O
inaceitável seria confiar na *Vercel Authentication* achando que ela protege
produção — ela só protege previews.

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

   Migrar cria as tabelas e mais nada. Banco só com as tabelas = login recusado,
   porque o callback do Google procura uma linha em `users` e não acha.

   `pnpm db:seed` não resolve: ele apaga e recria os dados do design, então
   recusa banco remoto de propósito. Quem prepara produção é `pnpm db:bootstrap`
   — aditivo, idempotente, cria usuário + árvore de categorias:

   ```powershell
   $env:DATABASE_URL_UNPOOLED = "<string DIRETA da branch main do Neon>"
   pnpm db:migrate
   pnpm db:bootstrap --email=voce@exemplo.com --name="Seu Nome"
   ```

   Conta e cartão **não** saem daqui: cadastre pela aba *Contas e cartões*, que
   valida e deixa escolher tipo, titular, cor e saldo de abertura. `--account`
   (com `--opening` em **centavos**) continua existindo para preparar um banco
   remoto sem abrir o painel. Categoria é o único cadastro que ainda não tem
   tela — por isso vem no bootstrap.

   **O `--email` tem que ser o mesmo do `GOOGLE_ALLOWED_EMAIL`.** É por ele que o
   callback encontra o usuário do app depois de o Google confirmar quem você é
   (a menos que `SINGLE_USER_ID` esteja declarada, que aí manda ela). Divergir dá
   "Acesso liberado, mas o banco não tem usuário" — login correto, painel vazio.
4. **Variáveis na Vercel**, nos três ambientes. `AUTH_SECRET` **diferente por
   ambiente**, senão um cookie de preview abre produção:

   | Variável | Production | Preview | Observação |
   |---|---|---|---|
   | `DATABASE_URL` | pooler da branch `main` | pooler da branch `dev` | **sem ela o build falha**, não só o runtime |
   | `AUTH_SECRET` | valor A | valor B | 32 bytes, distintos |
   | `GOOGLE_CLIENT_ID` | do console do Google | idem | pode ser o mesmo cliente OAuth |
   | `GOOGLE_CLIENT_SECRET` | do console do Google | idem | segredo de verdade |
   | `GOOGLE_ALLOWED_EMAIL` | seu e-mail | idem | a única conta que entra |
   | `APP_URL` | `https://seu-dominio` | URL do preview | monta o `redirect_uri`; tem que estar registrada no Google |
   | `CRON_SECRET` | gerado pela Vercel | — | sem ele `/api/cron/daily` recusa tudo |
   | `APP_TIMEZONE` | `America/Sao_Paulo` | idem | tem default; declarar é explicitação |
   | `SESSION_MAX_AGE_DAYS` | opcional | opcional | default 30 |
   | `SINGLE_USER_ID` | opcional | opcional | sem ela, o login usa o primeiro usuário — que é o único |

   Não declare na Vercel: `DATABASE_URL_UNPOOLED` — só os scripts de migration a
   usam, e eles rodam da sua máquina.

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
   - login entra; as abas do mês carregam com dado
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
