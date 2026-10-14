import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infra/db/schema.ts',
  out: './drizzle', // migrations SQL versionadas: sempre commitar
  dbCredentials: { url: process.env.DATABASE_URL! },
  // O schema "ai" pertence ao serviço Python (Alembic). O Drizzle nunca o toca.
  schemaFilter: ['public'],
})
