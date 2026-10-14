import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { db, pool } from './infra/db/client.js'
import { seed, seedSuperAdmin } from './seed.js'

// Roda antes do servidor subir (ver CMD do Dockerfile). Idempotente.
await migrate(db, { migrationsFolder: './drizzle' })
console.log('Migrations aplicadas')

await seed()
await seedSuperAdmin()

await pool.end()
