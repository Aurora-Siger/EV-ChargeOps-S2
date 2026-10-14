import { z } from 'zod'

// Plataformas de deploy (Coolify, compose) mandam variável declarada e vazia como "": vale como ausente.
const optional = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (v === '' ? undefined : v), t.optional())

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
  DISCORD_WEBHOOK_URL: optional(z.string().url()),
  AI_SERVICE_URL: z.string().url(),
  AI_INTERNAL_TOKEN: z.string().min(32),

  // ---------- SEMS+ (GoodWe) — login headless + coleta ----------
  SEMS_ACCOUNT: z.string().min(1),
  SEMS_PASSWORD: z.string().min(1),
  SEMS_LOGIN_URL: z.string().url().default('https://semsplus.goodwe.com/#/login'),
  SEMS_REGION: z.string().default('Americas'),
  SEMS_GATEWAY: z.string().url().default('https://us-gateway.semsportal.com'),
  SEMS_SN: z.string().default('57000HPA247L0002'),
  SEMS_STATION_ID: z.string().default('7f9af1fc-3a9a-4779-a4c0-ca6ec87bd93a'),
  SEMS_PRODUCT_MODEL: z.string().default('GW7K-HCA-20'),
  SEMS_HEADLESS: z.coerce.boolean().default(true),
  SEMS_LOGIN_TIMEOUT_MS: z.coerce.number().default(60_000),
  SEMS_POLL_INTERVAL_MS: z.coerce.number().default(300_000),
  SEMS_DEBUG_DIR: z.string().default('/tmp/sems-debug'),
  ADMIN_KEY: z.string().min(16),

  // ---------- Primeiro usuário (criado por migrate.ts se ainda não existir) ----------
  // Sem cadastro público, é assim que alguém entra pela primeira vez. Opcionais: sem eles, ninguém é criado.
  SUPER_ADMIN_EMAIL: z.string().email().optional(),
  SUPER_ADMIN_PASSWORD: z.string().min(8).optional(),
  SUPER_ADMIN_NAME: z.string().default('Administrador'),

  // ---------- Asaas (cobranças Pix/boleto) ----------
  // Sem ASAAS_API_KEY o app usa o gateway simulado (demo). Com ela, exige o token do webhook.
  // A chave começa com `$aact_`, e shell/compose/Coolify expandem `$...` e entregam vazio. Por isso
  // vale também sem o `$` inicial (`aact_...`): o app devolve o `$` aqui.
  ASAAS_API_KEY: optional(z.string().min(1).transform((k) => (k.startsWith('aact_') ? `$${k}` : k))),
  ASAAS_ENV: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['sandbox', 'production']).default('sandbox')),
  ASAAS_WEBHOOK_TOKEN: optional(z.string().min(32)),
}).refine((e) => !e.ASAAS_API_KEY || e.ASAAS_WEBHOOK_TOKEN, {
  message: 'ASAAS_WEBHOOK_TOKEN (32+ caracteres) é obrigatório quando ASAAS_API_KEY está definida',
  path: ['ASAAS_WEBHOOK_TOKEN'],
})

// Falha na subida se faltar variável: nunca ler process.env fora deste arquivo.
export const env = schema.parse(process.env)
