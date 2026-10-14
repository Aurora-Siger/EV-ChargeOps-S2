import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { env } from '../../config/env.js'
import { db } from '../db/client.js'
import * as schema from '../db/schema.js'

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
  // Só e-mail e senha. Sem cadastro público: contas são criadas pelo seed (seedSuperAdmin) e,
  // com o RBAC por condomínio, pelo admin do workspace.
  emailAndPassword: { enabled: true, disableSignUp: true },
  user: {
    additionalFields: {
      // input:false impede o cliente de se promover a ADMIN no cadastro
      role: { type: 'string', defaultValue: 'USER', input: false },
    },
  },
})

export type Auth = typeof auth
