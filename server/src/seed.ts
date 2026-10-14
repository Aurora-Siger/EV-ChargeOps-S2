import { env } from './config/env.js'
import { auth } from './infra/auth/auth.js'
import { db } from './infra/db/client.js'
import { station, charger } from './infra/db/schema.js'
import { residentsRepository } from './modules/residents/residents.repository.js'
import { workspacesRepository } from './modules/workspaces/workspaces.repository.js'
import { workspacesService } from './modules/workspaces/workspaces.service.js'

/**
 * Cria o SUPER_ADMIN a partir de SUPER_ADMIN_EMAIL/SUPER_ADMIN_PASSWORD, se ainda não existir.
 * Usa o adapter interno do Better Auth porque o cadastro público está desligado (disableSignUp),
 * o que também bloqueia o signUpEmail. Conta que já existe (de antes dos workspaces, quando era
 * ADMIN) é promovida, e os vínculos de admin dela saem: o superadmin entra em qualquer
 * condomínio sem ocupar o cargo de síndico.
 */
export async function seedSuperAdmin() {
  const { SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_NAME } = env
  if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) return

  const ctx = await auth.$context
  const email = SUPER_ADMIN_EMAIL.toLowerCase()
  const existing = await ctx.internalAdapter.findUserByEmail(email)
  if (existing) {
    if ((existing.user as { role?: string }).role !== 'SUPER_ADMIN') {
      await residentsRepository.setPlatformRole(existing.user.id, 'SUPER_ADMIN')
      await residentsRepository.removeAdminMemberships(existing.user.id)
      console.log(`${email} promovido a superadmin`)
    }
    return
  }

  const created = await ctx.internalAdapter.createUser(
    { email, name: SUPER_ADMIN_NAME, emailVerified: true, role: 'SUPER_ADMIN' },
    { method: 'admin' },
  )
  await ctx.internalAdapter.linkAccount({
    userId: created.id,
    providerId: 'credential',
    accountId: created.id,
    password: await ctx.password.hash(SUPER_ADMIN_PASSWORD),
  })
  console.log(`Usuário inicial criado: ${email}`)
}

export async function seed() {
  const count = await db.select({ id: station.id }).from(station).limit(1)
  if (count.length > 0) return // já semeado

  console.log('Semeando banco de dados com dados iniciais...')

  // O condomínio da demo, com configurações e tarifa base (R$ 0,52/kWh). Se a migration já
  // criou um workspace a partir de dados antigos, é ele.
  const aurora =
    (await workspacesRepository.firstActive()) ??
    (await workspacesService.create({ name: 'Edifício Aurora', address: 'Seu condomínio · vaga 12 da garagem' }))

  // O carregador do Edifício Aurora é o que recebe as sessões da SEMS (ensureSemsCharger).
  // Fotos em public/stations/ (servidas pelo próprio app).
  const stationsToInsert = [
    { name: 'Edifício Aurora', address: 'Seu condomínio · vaga 12 da garagem', latitude: -23.5748, longitude: -46.6322, power: 7, kind: 'CONDOMINIO' as const, openingHours: '24h para moradores', publicPriceCentsKwh: null, imageUrl: '/stations/edificio-aurora.webp' },
    { name: 'FIAP Paulista', address: 'Av. Paulista, 1106', latitude: -23.5665, longitude: -46.6495, power: 22, kind: 'PARCEIRO' as const, openingHours: 'seg a sáb, 7h–23h', publicPriceCentsKwh: 74, imageUrl: '/stations/fiap-paulista.jpg' },
    { name: 'FIAP Aclimação', address: 'Av. Lins de Vasconcelos, 1264', latitude: -23.5731, longitude: -46.6285, power: 22, kind: 'PARCEIRO' as const, openingHours: 'seg a sáb, 7h–23h', publicPriceCentsKwh: 74, imageUrl: '/stations/fiap-aclimacao.webp' },
    { name: 'MASP', address: 'Av. Paulista, 1578 · estacionamento', latitude: -23.5614, longitude: -46.6558, power: 50, kind: 'PUBLICO' as const, openingHours: 'ter a dom, 10h–18h', publicPriceCentsKwh: 120, imageUrl: null },
  ]

  for (const s of stationsToInsert) {
    const [st] = await db.insert(station).values({
      // só a estação do condomínio tem dono; parceiros e pontos públicos são da rede
      workspaceId: s.kind === 'CONDOMINIO' ? aurora.id : null,
      name: s.name,
      address: s.address,
      latitude: s.latitude,
      longitude: s.longitude,
      kind: s.kind,
      openingHours: s.openingHours,
      publicPriceCentsKwh: s.publicPriceCentsKwh,
      imageUrl: s.imageUrl,
    }).returning({ id: station.id })

    if (st) {
      await db.insert(charger).values({
        stationId: st.id,
        maxPowerKw: s.power.toString(),
        connector: 'Type 2',
      })
    }
  }

  console.log('Seed completo!')
}
