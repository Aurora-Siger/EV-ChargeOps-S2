# Contexto de build = raiz do repositório (o front vive na raiz):
#   Coolify → Base Directory "/"  ·  Dockerfile Location "/server/Dockerfile"
FROM node:24-alpine AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig*.json ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:24-alpine AS server
WORKDIR /srv
# Só baixa o pacote JS do Playwright aqui; o Chromium já vem pronto na imagem
# final (mesma versão do playwright em package.json — ver comentário abaixo).
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# Imagem oficial do Playwright: já traz Chromium + libs do sistema prontos.
# Alpine/musl não roda o Chromium do Playwright de forma confiável, por isso a
# imagem final não é node:24-alpine. Trave a tag na mesma versão
# do pacote "playwright" no package.json ao atualizar uma das duas.
FROM mcr.microsoft.com/playwright:v1.49.0-noble
WORKDIR /srv
ENV NODE_ENV=production PORT=3000
COPY --from=server /srv/node_modules ./node_modules
COPY --from=server /srv/dist ./dist
COPY --from=server /srv/package.json ./
COPY server/drizzle ./drizzle
COPY --from=web /web/dist ./public
EXPOSE 3000
# A imagem base não garante curl/wget; o healthcheck usa o próprio Node.
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Aplica migrations e sobe. Instância única por enquanto (sem corrida entre réplicas).
CMD ["sh", "-c", "node dist/migrate.js && node dist/main.js"]
