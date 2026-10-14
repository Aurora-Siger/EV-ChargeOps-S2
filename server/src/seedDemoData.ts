/**
 * Seed do condomínio de DEMONSTRAÇÃO — roda à mão antes de uma demo, nunca no boot de produção.
 *
 * Resolve o "cold start": rateio, curva de preço e o modelo de demanda (ai/training/train.py)
 * precisam de semanas de uso, e o carregador da FIAP tem um cartão só. O gerador
 * (demo/generator.ts) monta N semanas de um condomínio com moradores de hábitos diferentes,
 * sorteando energia e duração das 20 sessões reais do HCA G2 e repetindo a captura real no
 * período que ela cobre. Grava tudo como o coletor gravaria (sems_charge_log + sems_snapshot a
 * cada 5 min) e deixa o sync normal (sessionsService.syncFromSems) transformar em sessões,
 * atribuir pelo cartão RFID, calcular ociosidade e preço. Nenhum atalho no caminho do dado.
 *
 * Tudo que o seed cria é marcado (serial "DEMO-", `demo: true` no payload, e-mail
 * @demo.evchargeops.app), então `--reset` apaga só isso. Com sessões de fora do seed no banco
 * (o coletor já gravou recargas reais), o seed só roda com `--alongside-real`: aí ele não repete
 * a captura (as recargas reais já estão lá e vão para a Ana, dona do cartão real) e só grava
 * status sintético ANTES do primeiro status real, pra não contradizer a telemetria de verdade.
 *
 * Uso (cd server):
 *   npm run seed:demo                         # 8 semanas, 4 moradores, seed 42
 *   npm run seed:demo -- --weeks 12 --seed 7  # outro condomínio, mesmo formato
 *   npm run seed:demo -- --personas ana,diego # só alguns moradores
 *   npm run seed:demo -- --no-real            # tudo sintético (sem repetir a captura)
 *   npm run seed:demo -- --reset              # apaga a demo anterior e gera de novo
 *   npm run seed:demo -- --alongside-real     # banco com coletor real rodando (produção)
 * Em produção (imagem compilada): node dist/seedDemoData.js [mesmas flags]
 *
 * Senha dos moradores: --password ou DEMO_RESIDENT_PASSWORD; sem nenhuma, gera uma e imprime.
 */
import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { and, eq, inArray, like, notLike, sql } from 'drizzle-orm'
import { chargeLogPayload, generateSessions, PERSONAS, telemetry } from './demo/generator.js'
import { db, pool } from './infra/db/client.js'
import { chargeSession, semsChargeLog, semsSnapshot, unit, user } from './infra/db/schema.js'
import { billingService } from './modules/billing/billing.service.js'
import { residentsRepository } from './modules/residents/residents.repository.js'
import { residentsService } from './modules/residents/residents.service.js'
import { sessionsService } from './modules/sessions/sessions.service.js'
import { settingsService } from './modules/settings/settings.service.js'
import { stationsService } from './modules/stations/stations.service.js'
import { DEVICE_SN } from './realSessions.js'
import { periodOf, shiftPeriod } from './shared/time.js'

const DEMO_EMAIL_DOMAIN = 'demo.evchargeops.app'
const DEMO_IDLE_CENTS_PER_MINUTE = 10 // R$ 0,10/min depois da carência, só se o condomínio estiver em 0

const { values: args } = parseArgs({
  options: {
    weeks: { type: 'string', default: '8' },
    seed: { type: 'string', default: '42' },
    personas: { type: 'string' },
    'no-real': { type: 'boolean', default: false },
    reset: { type: 'boolean', default: false },
    'alongside-real': { type: 'boolean', default: false },
    password: { type: 'string' },
  },
})

async function hasRealSemsData() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(semsChargeLog).where(notLike(semsChargeLog.serial, 'DEMO-%'))
  return (row?.n ?? 0) > 0
}

async function hasDemoData() {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(semsChargeLog).where(like(semsChargeLog.serial, 'DEMO-%'))
  return (row?.n ?? 0) > 0
}

async function resetDemo(workspaceId: string) {
  await db.delete(chargeSession).where(like(chargeSession.serial, 'DEMO-%'))
  await db.delete(semsChargeLog).where(like(semsChargeLog.serial, 'DEMO-%'))
  await db.delete(semsSnapshot).where(sql`${semsSnapshot.payload}->>'demo' = 'true'`)
  await db.delete(user).where(like(user.email, `%@${DEMO_EMAIL_DOMAIN}`)) // cartões, faturas e reservas vão em cascata
  await db
    .delete(unit)
    .where(and(eq(unit.workspaceId, workspaceId), inArray(unit.label, PERSONAS.map((p) => p.unitLabel))))
  console.log('Demo anterior apagada.')
}

async function main() {
  const weeks = Math.max(1, Math.min(52, Number(args.weeks)))
  const seed = Number(args.seed)
  const keys = args.personas?.split(',').map((k) => k.trim())
  const personas = keys ? PERSONAS.filter((p) => keys.includes(p.key)) : PERSONAS
  if (personas.length === 0) throw new Error(`nenhum morador em --personas; opções: ${PERSONAS.map((p) => p.key).join(', ')}`)

  const alongsideReal = await hasRealSemsData()
  if (alongsideReal && !args['alongside-real']) {
    console.log(
      'O banco já tem sessões que não são do seed (coletor real ou seed antigo). Para gerar a demo junto delas, ' +
        'rode com --alongside-real; para um banco só de demo, limpe sems_charge_log antes.',
    )
    return
  }
  // A demo mora no condomínio do carregador da SEMS.
  const chargerId = await stationsService.ensureSemsCharger()
  const workspaceId = await stationsService.workspaceOfCharger(chargerId)
  if (!workspaceId) throw new Error('o carregador da SEMS não está em nenhum condomínio')

  if (await hasDemoData()) {
    if (!args.reset) {
      console.log('Já existe uma demo no banco. Use --reset para apagar e gerar de novo.')
      return
    }
    await resetDemo(workspaceId)
  }

  const now = new Date()
  const sessions = generateSessions({ weeks, seed, end: now, personas, replayReal: !args['no-real'] && !alongsideReal })
  console.log(`Gerando ${weeks} semanas, seed ${seed}: ${sessions.length} sessões de ${personas.length} moradores.`)

  // 1) Condomínio: unidades ligadas à estação do carregador da SEMS, moradores e cartões.
  const stationId = (await stationsService.chargerById(chargerId))?.stationId ?? null
  const password = args.password ?? process.env.DEMO_RESIDENT_PASSWORD ?? randomBytes(6).toString('base64url')
  const existingCards = new Set((await residentsRepository.listCards({})).map((c) => c.cardNumber))
  const seeder = { userId: 'seed', platformRole: 'SUPER_ADMIN' as const, memberRole: null }
  for (const p of personas) {
    const u = await db.insert(unit).values({ workspaceId, label: p.unitLabel, stationId }).onConflictDoNothing().returning()
    const unitId =
      u[0]?.id ??
      (await db.select().from(unit).where(and(eq(unit.workspaceId, workspaceId), eq(unit.label, p.unitLabel))))[0]!.id
    const created = await residentsService.createUser(seeder, workspaceId, {
      name: p.name,
      email: `${p.key}@${DEMO_EMAIL_DOMAIN}`,
      password,
      role: 'USER',
      unitId,
    })
    await residentsService.createVehicle(created.id, p.vehicle)
    if (existingCards.has(p.cardNumber)) {
      console.log(`Cartão ${p.cardNumber} já está cadastrado; ${p.name} fica sem ele.`)
    } else {
      await residentsRepository.createCard({ cardNumber: p.cardNumber, userId: created.id, label: 'Cartão demo', active: true })
    }
    console.log(`  ${p.unitLabel} · ${p.name} (${p.key}@${DEMO_EMAIL_DOMAIN}): ${p.habit}`)
  }

  // 2) O que o coletor teria gravado: log de sessões e status a cada 5 min.
  await db.insert(semsChargeLog).values(sessions.map((s) => ({ serial: s.serial, payload: chargeLogPayload(s) })))
  const from = new Date(sessions[0]!.start.getTime() - 24 * 3_600_000)
  const [firstReal] = await db
    .select({ at: sql<Date>`min(${semsSnapshot.collectedAt})` })
    .from(semsSnapshot)
    .where(sql`${semsSnapshot.kind} = 'detail' and coalesce(${semsSnapshot.payload}->>'demo', '') <> 'true'`)
  const until = firstReal?.at ? new Date(Math.min(now.getTime(), new Date(firstReal.at).getTime() - 1)) : now
  const samples = until > from ? telemetry(sessions, from, until, 5) : []
  for (let i = 0; i < samples.length; i += 1000) {
    await db.insert(semsSnapshot).values(
      samples.slice(i, i + 1000).map((t) => ({ kind: 'detail' as const, collectedAt: t.at, payload: t.payload })),
    )
  }
  const last = sessions[sessions.length - 1]!
  if (!alongsideReal) await db.insert(semsSnapshot).values([
    {
      kind: 'last_charge',
      collectedAt: now,
      payload: {
        demo: true,
        chargeLog: {
          chargePileSN: DEVICE_SN, currentChargeQuantity: last.kwh, chargeTimeLength: last.min, mileage: last.km,
          unit: 'km', chargeCardNumber: last.cardNumber, charGun: 1,
          averCharP: Math.round((last.kwh / (last.min / 60)) * 1000) / 1000, maxCharP: 3.5,
          status: 0, overViewStatus: 1, chartUnit: 'kWh', workStu: 8,
        },
      },
    },
    {
      kind: 'capabilities',
      collectedAt: now,
      payload: {
        demo: true, productModel: 'GW7K-HCA-20', ratedPower: 7.0, pileThreeCodes: 'HPA', pileGeneration: '2',
        dashboardFunctions: ['startCharging', 'chargingModeSelection', 'chargingModeReservation', 'approximateDrivingMode', 'plugAndCharge'],
        moreDeviceControls: ['Output_Power_Setting', 'Dynamic_Load_Control', 'Ensure_minimum_Charging_Power', 'Card_Management'],
      },
    },
  ])
  console.log(`${sessions.length} sessões em sems_charge_log e ${samples.length} status em sems_snapshot.`)

  // 3) Ociosidade só pesa se tiver preço: liga o exemplo se o condomínio ainda estiver em zero.
  const settings = await settingsService.get(workspaceId)
  if (settings.idleCentsPerMinute === 0) {
    await settingsService.update(workspaceId, { idleCentsPerMinute: DEMO_IDLE_CENTS_PER_MINUTE })
    console.log(`Ociosidade: R$ ${(DEMO_IDLE_CENTS_PER_MINUTE / 100).toFixed(2)}/min depois de ${settings.idleGraceMinutes} min de carência.`)
  }

  // 4) Mesmo caminho do dado real: sessões, dono pelo cartão, ociosidade e preço.
  const synced = await sessionsService.syncFromSems()
  console.log(`Sync: ${synced.imported} sessões importadas, ${synced.priced} precificadas.`)

  // 5) Fecha o mês anterior, pra a fatura do morador ter com o que comparar.
  const previous = shiftPeriod(periodOf(now), -1)
  const cycle = await billingService.close(workspaceId, previous)
  console.log(`Ciclo ${previous} fechado: ${cycle.lines.filter((l) => l.active).length} faturas.`)

  console.log(`\nSenha dos moradores demo: ${password}`)
  console.log('Para treinar o modelo shadow nesse histórico: cd ai && python -m training.train')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((err) => {
      console.error('Seed de demo falhou:', err)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
