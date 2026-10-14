# Deploy no Coolify

Produção roda em uma VPS com Coolify, com três recursos no mesmo projeto: PostgreSQL com
pgvector, o serviço `ai` e o `server` (que também serve o build do front). Visão geral em
[`ARCHITECTURE.md`](./ARCHITECTURE.md) §8.

Ordem: Postgres → `server` → `ai`. Cada serviço aplica as próprias migrations na subida.

## 1. PostgreSQL

*New Resource → Database → PostgreSQL*, com a imagem `pgvector/pgvector:pg17` (a imagem padrão
do Coolify não traz a extensão `vector`, e a migration `0001` do `ai` roda
`CREATE EXTENSION vector`). Banco `evchargeops`, usuário `evcharge`, senha forte, backup
diário ligado.

A URL interna vem como `postgres://evcharge:SENHA@<host-interno>:5432/evchargeops`. O
`server` aceita assim; o `ai` precisa do driver explícito: `postgresql+psycopg://...`.

## 2. `server`

| Campo | Valor |
|---|---|
| Build Pack | `Dockerfile` |
| Base Directory | `/` (o Dockerfile também compila o front, que fica na raiz) |
| Dockerfile Location | `/server/Dockerfile` |
| Ports Exposes | `3000` |
| Pre-deploy Command | vazio: o `CMD` roda `node dist/migrate.js` antes de subir |

Variáveis: as de `server/.env.example`, com a tabela completa em `ARCHITECTURE.md` §8.1.
`AI_SERVICE_URL` aponta para o alias de rede do `ai` (ver abaixo). Para cobrar de verdade,
defina `ASAAS_API_KEY`, `ASAAS_ENV` e `ASAAS_WEBHOOK_TOKEN` e cadastre
`https://<domínio>/api/webhooks/asaas` no painel do Asaas com o mesmo token; sem a chave o
app usa o gateway simulado. A chave do Asaas começa com `$`, que o Coolify expande: cole sem o
`$` inicial (o app devolve) ou marque a variável como "Literal". Os moradores precisam ter
CPF/CNPJ cadastrado (Perfil → Dados de cobrança) para o Asaas emitir.

O `server` manda `Cache-Control: no-cache` em tudo fora de `/assets`: depois de um redeploy, o
navegador não fica com um `index.html` antigo apontando para arquivos que já não existem.

A imagem final é `mcr.microsoft.com/playwright`, e não `node:24-alpine`, porque o coletor faz
login na SEMS+ com o Chromium do Playwright, que não roda de forma confiável em musl. A tag
da imagem acompanha a versão do pacote `playwright` em `server/package.json`.

Domínio público só neste recurso. Bloqueie `/internal/*` e `/admin/*` no proxy; o token é a
segunda camada.

## 3. `ai`

| Campo | Valor |
|---|---|
| Build Pack | `Dockerfile` |
| Base Directory | `/ai` |
| Dockerfile Location | `/ai/Dockerfile` |
| Ports Exposes | `8000` |
| Domínio | nenhum: só o `server` fala com ele |

Variáveis: `DATABASE_URL` (com `+psycopg`), `OPENAI_API_KEY`, `AI_INTERNAL_TOKEN` (o mesmo do
`server`, 32+ caracteres, `openssl rand -hex 32`) e `BACKEND_URL` (endereço interno do
`server`).

O entrypoint espera o Postgres, roda `alembic upgrade head`, indexa a base de conhecimento do
RAG e sobe o uvicorn. Limite a memória do recurso (por exemplo 1 GB) para não disputar com o
Postgres numa VPS de 4 GB.

**Alias de rede.** O Coolify põe um sufixo por deploy no nome do container, então um
`AI_SERVICE_URL` com o nome do container quebra no próximo redeploy do `ai`. Em
*Networking → Network aliases* do `ai`, crie um alias fixo (`ai-service`) e use
`AI_SERVICE_URL=http://ai-service:8000` no `server`.

## 4. Treinar o modelo de demanda

O treino roda dentro do container do `ai`, que lê a telemetria do banco. Pela aba Terminal do
recurso:

```bash
cd /app && python -m training.train
```

O artefato só é salvo em `/app/models/` se vencer o baseline ingênuo, e o motor passa a
carregá-lo em modo shadow (`ARCHITECTURE.md` §7.1).

## 5. Dados de demonstração

A imagem do `server` só leva o código compilado, então o seed roda com `node`:

```bash
cd /srv && node dist/seedDemoData.js --alongside-real --password <senha>
```

`--alongside-real` é obrigatório quando o coletor já gravou recargas reais.

## 6. Problemas comuns

| Sintoma | Causa |
|---|---|
| `server` responde `503 AI_UNAVAILABLE` no Volt | o `server` não alcança o `ai`: confira o alias e, no Terminal do `server`, `env \| grep AI_SERVICE_URL` (o painel pode mostrar um valor que o container não carregou) |
| `server` responde `502` no Volt | o `ai` respondeu com erro: `AI_INTERNAL_TOKEN` diferente nos dois lados ou `OPENAI_API_KEY` inválida |
| `ai` não sobe com `ValidationError` | falta uma das quatro variáveis obrigatórias (`ai/app/core/config.py`) |
| `exec /usr/local/bin/entrypoint: no such file or directory` | `docker-entrypoint.sh` com CRLF; o `.gitattributes` evita isso |
| coletor não loga na SEMS+ | credenciais erradas ou captcha; `GET /admin/sems/debug/login-screenshot` (com `ADMIN_KEY`) mostra a tela no momento da falha |

## 7. Versões do `ai`

O `pyproject.toml` usa faixas abertas e o `uv.lock` fixa o que foi testado (hoje langchain
1.x e langgraph 1.x). Depois de mexer em dependências, rode `uv lock` e versione o lock junto.
