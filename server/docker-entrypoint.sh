#!/bin/sh
set -e

# O compose já espera o Postgres ficar healthy (depends_on), então não precisa de sleep.
# migrate.ts aplica as migrations, cria estação/carregador/tarifa (seed) e o super admin
# (SUPER_ADMIN_*). Sem ele não existe login nem a estação que recebe os dados da SEMS.
echo "Rodando migrations e seed..."
npx tsx src/migrate.ts

# Recargas de demonstração: não roda de novo se já houver log salvo.
echo "Carregando dados de demonstração..."
npm run seed:demo || echo "seed:demo falhou, seguindo sem dados de demonstração"

echo "Iniciando dev server..."
exec npm run dev
