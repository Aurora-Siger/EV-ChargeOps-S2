import { useMemo, useState } from 'react'
import Volt from '../../components/Volt'
import {
  GOAL_DEFAULT,
  GOAL_KIND_LABEL,
  GOAL_KINDS,
  GOAL_OPTIONS,
  TARGETS,
  TARGET_USE,
  availableTargets,
  goalParams,
  kmFor,
  rangeAt,
  roomKwh,
  socAfter,
  type ChargeGoal,
} from '../../lib/energyPricing'
import { fmtBRL, fmtDay, fmtKwh, fmtNum, fmtTime, fromLocal, local, WEEKDAYS } from '../../lib/format'
import { api } from '../../lib/http'
import type { PlugInPreview, Reservation, StartSlot, StartSlots, Station, Vehicle } from '../../lib/types'
import { useApi } from '../../lib/useApi'
import { distanceKm, fmtDistance, placeholderGradient } from '../../lib/chargePoints'
import { I } from './icons'
import ReservationCard, { goalLabel } from './ReservationCard'
import { Empty, ErrorBox } from './ui'
import { useMe } from './me'
import { useAction } from '../../lib/useAction'
import type { Tab } from './App'
import { t } from '../../lib/i18n'

const DAYS_AHEAD = 7

/** Hoje + 6 dias, no horário do condomínio. */
function nextDays() {
  const today = local(new Date())
  return Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const start = fromLocal(today.year, today.month, today.day + i)
    const end = fromLocal(today.year, today.month, today.day + i + 1)
    const l = local(start)
    return { start, end, w: i === 0 ? t('hoje', 'today') : i === 1 ? t('amanhã', 'tomorrow') : WEEKDAYS[l.weekday], n: l.day }
  })
}

const slotKey = (s: StartSlot) => (s.now ? 'now' : s.startsAt)

/** Local da reserva no formato de `/api/me/reservations` (a resposta do POST não traz). */
const placeOf = (s: Station | null) => ({ stationName: s?.name ?? null, stationAddress: s?.address ?? null, stationKind: s?.kind ?? null })

function stationDistanceKm(a: Station, b: Station) {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return null
  return distanceKm({ lat: a.latitude, lon: a.longitude }, { lat: b.latitude, lon: b.longitude })
}

/** Linha de local ("Edifício Aurora · endereço") das reservas. */
/** Foto do carregador no local — se a estação não tem `imageUrl` cadastrada (ou o link quebrou), cai num fundo gerado. */
function PlacePhoto({ own, imageUrl, seed }: { own: boolean; imageUrl: string | null; seed: string }) {
  const [broken, setBroken] = useState(false)
  const showImg = imageUrl && !broken
  return (
    <div className="place-photo" style={showImg ? undefined : { background: placeholderGradient(seed) }}>
      {showImg ? (
        <img className="place-photo-img" src={imageUrl} alt="" onError={() => setBroken(true)} />
      ) : (
        <span className="place-photo-ic">{I.bolt}</span>
      )}
      <span className={`place-kind ${own ? 'own' : ''}`}>{own ? t('Seu condomínio', 'Your building') : t('Parceiro da rede', 'Network partner')}</span>
    </div>
  )
}

type Mode = 'now' | 'later'
type WizardStep = 0 | 1 | 2 | 3
const wizardLabels = () => [t('Onde', 'Where'), t('Quando', 'When'), t('Quanto', 'How much'), t('Confirmar', 'Confirm')]

/** Cor por faixa de preço, pra pintar a trilha do slider de horário (verde barato → vermelho pico). */
const LEVEL_COLOR: Record<StartSlot['level'], string> = { cheap: 'var(--green)', mid: 'var(--amber)', peak: 'var(--red)' }

/** Trilha em blocos de cor: cada horário livre vira um segmento proporcional, na ordem do dia. */
function sliderGradient(slots: StartSlot[]) {
  if (slots.length === 0) return 'var(--bg3)'
  const n = slots.length
  const stops = slots.map((s, i) => `${LEVEL_COLOR[s.level]} ${(i / n) * 100}%, ${LEVEL_COLOR[s.level]} ${((i + 1) / n) * 100}%`)
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

/**
 * A bateria do carro cadastrado como referência: capacidade real (kWh), autonomia de carga cheia
 * e uma barra com a carga atual (quando conhecida) e até onde a meta leva.
 */
function BatteryGauge({ vehicle, soc, target, go }: { vehicle: Vehicle; soc: number | null; target: number; go: (t: Tab) => void }) {
  const km = rangeAt(vehicle, 100)
  return (
    <div className="batt">
      <div className="batt-head">
        <span>{t('Bateria', 'Battery')}</span>
        <b>
          {fmtKwh(vehicle.capacityKwh)}
          {km !== null ? ` · ${km} km` : ''}
        </b>
      </div>
      <div className="batt-bar" role="img" aria-label={`${soc !== null ? `${t('agora', 'now')} ${soc}%, ` : ''}${t('meta', 'target')} ${target}%`}>
        <div className="batt-target" style={{ width: `${target}%` }} />
        {soc !== null && <div className="batt-now" style={{ width: `${soc}%` }} />}
      </div>
      {km === null && (
        <button className="hint-line batt-link" onClick={() => go('perfil')}>
          {t('Cadastra a autonomia do carro no Perfil pra ver a meta em km.', 'Add the car range in Profile to see the target in km.')}
        </button>
      )}
    </div>
  )
}


/**
 * Quanto carregar, em três formas: autonomia (a meta de bateria em km), energia (kWh) ou valor
 * (R$). Em cima a forma, no meio o resultado em destaque, embaixo as opções. `fromSoc` é a
 * bateria de partida (a lida, ou a estimada) e `priceCentsKwh` o preço médio da janela já
 * calculada, só pra traduzir o valor em energia e km.
 */
function GoalPicker({
  vehicle,
  goal,
  fromSoc,
  socEnabled,
  priceCentsKwh,
  onPick,
}: {
  vehicle: Vehicle
  goal: ChargeGoal
  fromSoc: number
  socEnabled: number[]
  priceCentsKwh: number | null
  onPick: (g: ChargeGoal) => void
}) {
  const room = roomKwh(vehicle, fromSoc)
  const fmtKm = (kwh: number) => {
    const km = kmFor(vehicle, kwh)
    return km !== null ? `+${km} km` : null
  }

  let big: string
  let sub: (string | null | undefined)[]
  if (goal.kind === 'SOC') {
    const km = rangeAt(vehicle, goal.value)
    big = km !== null ? `${km} km` : `${goal.value}%`
    sub = [km !== null ? `${t('bateria em', 'battery at')} ${goal.value}%` : fmtKwh((goal.value / 100) * vehicle.capacityKwh), TARGET_USE[goal.value]]
  } else if (goal.kind === 'KWH') {
    const kwh = Math.min(goal.value, room)
    big = `${goal.value} kWh`
    sub = [fmtKm(kwh), `${t('bateria até', 'battery up to')} ${socAfter(vehicle, fromSoc, kwh)}%`]
  } else {
    const kwh = priceCentsKwh ? Math.min(room, goal.value / priceCentsKwh) : null
    big = `R$ ${goal.value / 100}`
    sub = kwh === null ? [t('no máximo', 'at most')] : kwh >= room - 0.5 ? [t('enche a bateria', 'fills the battery')] : [`≈ ${fmtKwh(kwh, 1)}`, fmtKm(kwh)]
  }

  const options: { v: number; label: string; disabled?: boolean }[] =
    goal.kind === 'SOC'
      ? TARGETS.map((t) => ({ v: t, label: `${t}%`, disabled: !socEnabled.includes(t) }))
      : goal.kind === 'KWH'
        ? GOAL_OPTIONS.KWH.map((v) => ({ v, label: `${v} kWh`, disabled: v > room + 0.5 }))
        : GOAL_OPTIONS.BRL.map((v) => ({ v, label: `R$ ${v / 100}` }))

  return (
    <div className="goal">
      <div className="goal-tabs" role="tablist" aria-label={t('Forma de pedir a carga', 'How to order the charge')}>
        {GOAL_KINDS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={goal.kind === k}
            className={`goal-tab ${goal.kind === k ? 'on' : ''}`}
            onClick={() => goal.kind !== k && onPick({ kind: k, value: GOAL_DEFAULT[k] })}
          >
            {GOAL_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="goal-readout" aria-live="polite">
        <div className="goal-big">{big}</div>
        <div className="goal-sub">{sub.filter(Boolean).join(' · ')}</div>
      </div>
      <div className="goal-chips">
        {options.map((o) => (
          <button
            key={o.v}
            className={`goal-chip ${goal.value === o.v ? 'on' : ''}`}
            disabled={o.disabled}
            onClick={() => onPick({ kind: goal.kind, value: o.v })}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** O custo estimado em destaque no topo do resumo, com a faixa de preço da janela. */
const costLevel = () => ({ cheap: t('horário barato', 'cheap hours'), mid: t('horário normal', 'normal hours'), peak: t('horário de pico', 'peak hours') })

function CostHero({ cents, level }: { cents: number; level: StartSlot['level'] }) {
  const COST_LEVEL = costLevel()
  return (
    <div className="cost-hero">
      <div>
        <span className="k">{t('Custo estimado', 'Estimated cost')}</span>
        <b>{fmtBRL(cents)}</b>
      </div>
      <span className={`cost-level ${level}`}>
        <i />
        {COST_LEVEL[level]}
      </span>
    </div>
  )
}

/** "20% · ~56 km" — a bateria informada já traduzida em autonomia. */
function socLabel(vehicle: Vehicle, soc: number) {
  const km = rangeAt(vehicle, soc)
  return km !== null ? `${soc}% · ~${km} km` : `${soc}%`
}

export default function Agendar({ go }: { go: (t: Tab) => void }) {
  const WIZARD_LABELS = wizardLabels()
  const { me } = useMe()
  const charger = me.charger
  const [vehicleId, setVehicleId] = useState(me.vehicles[0]?.id ?? '')
  const vehicle = me.vehicles.find((v) => v.id === vehicleId) ?? me.vehicles[0]

  const days = useMemo(() => nextDays(), [])
  // relógio da tela: fixo por montagem (o morador recarrega a tela para andar o "agora")
  const [nowMs] = useState(() => Date.now())

  const stations = useApi<Station[]>('/api/stations', { pollMs: 15_000 })
  const mine = useApi<Reservation[]>('/api/me/reservations')
  const occupant = useApi<{ name: string; isMe: boolean } | null>('/api/me/charger-occupant', { pollMs: 15_000 })
  const action = useAction()
  const [done, setDone] = useState<Reservation | null>(null)

  const home = stations.data?.find((s) => s.chargers.some((c) => c.id === charger?.id)) ?? null
  // Ocupado por outro morador (cartão RFID da sessão): "já plugado" não é do usuário, só agendar.
  const busyByOther = !!occupant.data && !occupant.data.isMe
  const pluggedIn = (home?.pluggedIn ?? false) && !busyByOther
  const telemetrySoc = home?.soc ?? null

  const [modePick, setModePick] = useState<Mode>('now')
  // "Já plugado" só existe com o carro na tomada do condomínio agora; sem isso, só agendar
  const mode: Mode = pluggedIn ? modePick : 'later'
  const [placePick, setPlacePick] = useState<string | null>(null)
  // quanto carregar: autonomia (% em km), energia (kWh) ou valor (R$)
  const [goal, setGoal] = useState<ChargeGoal>({ kind: 'SOC', value: 80 })
  const target = goal.kind === 'SOC' ? goal.value : 80
  // null = ainda não escolheu: abre no primeiro dia com horário livre
  const [dayPick, setDayPick] = useState<number | null>(null)
  const [slotPick, setSlotPick] = useState<string | null>(null)
  // assistente de 3 telas do "agendar pra depois": onde (0) → quando (1) → quanto (2) → confirmar (3)
  const [wizardStep, setWizardStep] = useState<WizardStep>(0)

  const reset = () => {
    setDone(null)
    setWizardStep(0)
  }


  // A tela nunca pergunta a bateria atual (o morador nem sempre sabe): vale a da telemetria; sem
  // ela, o servidor estima e ajusta o fim da carga quando o carregador ler a bateria.
  const liveSoc = telemetrySoc
  const targetsNow = liveSoc !== null ? availableTargets(liveSoc) : TARGETS
  const activeTargetNow = targetsNow.includes(target) ? target : (targetsNow[0] ?? 100)
  const goalNow: ChargeGoal = goal.kind === 'SOC' ? { kind: 'SOC', value: activeTargetNow } : goal
  // horário futuro também não pergunta: até lá a bateria muda
  const goalLater = goal
  const goalQuery = (g: ChargeGoal) => Object.fromEntries(Object.entries(goalParams(g)).map(([k, v]) => [k, String(v)]))

  // Onde dá pra reservar: o condomínio do morador e os parceiros da rede (mais perto primeiro).
  // "Own" usa o mesmo sinal do "já plugado" acima (o carregador de `me.charger`) — não
  // `me.station`, que fica null sem unidade vinculada mesmo quando `me.charger` já resolveu pro
  // carregador certo (fallback pro carregador da SEMS em server/src/modules/me/me.routes.ts).
  const places = useMemo(() => {
    const own = stations.data?.find((s) => s.chargers.some((c) => c.id === charger?.id)) ?? null
    const dist = (s: Station) => (own ? stationDistanceKm(own, s) : null)
    return (stations.data ?? [])
      .filter((s) => s.chargers.length > 0 && (s.id === own?.id || s.kind === 'PARCEIRO'))
      .map((s) => ({ station: s, own: s.id === own?.id, km: s.id === own?.id ? null : dist(s) }))
      .sort((a, b) => Number(b.own) - Number(a.own) || (a.km ?? Infinity) - (b.km ?? Infinity))
  }, [stations.data, charger?.id])
  const place = places.find((p) => p.station.id === placePick) ?? places[0] ?? null
  const placeChargerId = place ? (place.own && charger ? charger.id : place.station.chargers[0].id) : null
  const pickPlace = (id: string) => {
    setPlacePick(id)
    setDayPick(null)
    setSlotPick(null)
    setWizardStep(1)
  }

  // "agendar pra depois": horários de início dos próximos 7 dias, numa busca só (trocar de dia é instantâneo)
  const slotsPath =
    mode === 'later' && placeChargerId && vehicle
      ? `/api/reservations/start-slots?${new URLSearchParams({
          chargerId: placeChargerId,
          vehicleId: vehicle.id,
          ...goalQuery(goalLater),
          from: days[0].start.toISOString(),
          to: days[DAYS_AHEAD - 1].end.toISOString(),
        })}`
      : null
  const starts = useApi<StartSlots>(slotsPath, { pollMs: 60_000 })
  // trocando de local, a busca anterior não vale mais (o useApi mantém o dado velho enquanto carrega)
  const slotsData = starts.loading ? null : starts.data
  const slotsByDay = days.map((d) =>
    (slotsData?.slots ?? []).filter((s) => {
      const at = new Date(s.startsAt).getTime()
      return at >= d.start.getTime() && at < d.end.getTime()
    }),
  )
  const firstOpenDay = slotsData ? slotsByDay.findIndex((ss) => ss.some((s) => s.free)) : -1
  const day = dayPick ?? Math.max(firstOpenDay, 0)
  const daySlots = slotsByDay[day]
  const chosen = daySlots.find((s) => s.free && slotKey(s) === slotPick) ?? null
  const cheapest = daySlots
    .filter((s) => s.free && s.costCents !== null)
    .reduce<StartSlot | null>((best, s) => (!best || s.costCents! < best.costCents! ? s : best), null)
  // sem escolha explícita, o slider e a confirmação partem do mais barato do dia — nunca ficam vazios à toa
  const freeDaySlots = daySlots.filter((s) => s.free)
  const activeSlot = chosen ?? cheapest
  const sliderIndex = activeSlot ? Math.max(freeDaySlots.indexOf(activeSlot), 0) : 0
  const sliderPct = freeDaySlots.length > 1 ? (sliderIndex / (freeDaySlots.length - 1)) * 100 : 50
  // horários mais baratos que o escolhido, pra trocar com um toque na tela de confirmação
  // preço médio por kWh da janela escolhida, pra traduzir o valor em autonomia nas opções
  const laterPriceKwh = activeSlot?.costCents && activeSlot.energyKwh > 0 ? activeSlot.costCents / activeSlot.energyKwh : null
  // bateria onde a janela escolhida chega (partindo dos 20% estimados)
  const laterSoc = goalLater.kind === 'SOC' ? goalLater.value : activeSlot ? socAfter(vehicle ?? me.vehicles[0], slotsData?.assumedStartSoc ?? 20, activeSlot.energyKwh) : 80
  const cheaperAlternatives = activeSlot?.costCents
    ? daySlots
        .filter((s) => s.free && s !== activeSlot && s.costCents !== null && s.costCents < activeSlot.costCents!)
        .sort((a, b) => a.costCents! - b.costCents!)
        .slice(0, 3)
    : []

  const optionsPath =
    mode === 'now' && pluggedIn && charger && vehicle && (liveSoc === null || liveSoc < 99)
      ? `/api/reservations/now-preview?${new URLSearchParams({ chargerId: charger.id, vehicleId: vehicle.id, ...goalQuery(goalNow) })}`
      : null
  // já plugado não espera hora barata: começa agora, a prévia só mostra quando fica pronto e o custo
  const nowPreview = useApi<PlugInPreview>(optionsPath, { pollMs: 60_000 })
  const preview = nowPreview.loading ? null : nowPreview.data
  const nowPriceKwh = preview?.window && preview.energyKwh > 0 ? preview.window.costCents / preview.energyKwh : null

  if (!charger) {
    return (
      <div className="screen-anim">
        <div className="screen-title">{t('Agendar recarga', 'Book a charge')}</div>
        <ErrorBox error={t('Nenhum carregador vinculado à sua unidade. Fale com o gestor do condomínio.', 'No charger linked to your unit. Talk to the building manager.')} />
      </div>
    )
  }

  if (!vehicle) {
    return (
      <div className="screen-anim">
        <div className="screen-title">{t('Agendar recarga', 'Book a charge')}</div>
        <div className="screen-sub">{t('Para calcular quanto tempo e quanto custa, o app precisa conhecer o seu carro.', 'To calculate how long and how much it costs, the app needs to know your car.')}</div>
        <div className="c">
          <Empty>{t('Você ainda não cadastrou um veículo.', "You haven't added a vehicle yet.")}</Empty>
          <button className="btn btn-primary" onClick={() => go('perfil')}>
            {t('Cadastrar meu carro', 'Add my car')}
          </button>
        </div>
      </div>
    )
  }

  if (done) {
    const scheduled = done.status === 'SCHEDULED' && done.startsAt && done.endsAt
    return (
      <div className="screen-anim">
        <div className="success">
          <div className="ring">{I.check}</div>
          <h2>{scheduled ? t('Reserva confirmada!', 'Booking confirmed!') : t('Combinado!', 'All set!')}</h2>
          {scheduled && done.startSoc === null && done.stationKind === 'PARCEIRO' ? (
            <p>
              {fmtDay(done.startsAt!)} · {fmtTime(done.startsAt!)} às ~{fmtTime(done.endsAt!)}, {goalLabel(done)}
              {done.estimatedCostCents !== null && <> — {t('estimado até', 'estimated up to')} {fmtBRL(done.estimatedCostCents)}</>}.
            </p>
          ) : scheduled && done.startSoc === null ? (
            <p>
              {fmtDay(done.startsAt!)} · {fmtTime(done.startsAt!)} {t('às', 'at')} ~{fmtTime(done.endsAt!)}, {goalLabel(done)}. {t('Quando o', 'When the')}{' '}
              {vehicle.model} {t('plugar, a gente lê a bateria e ajusta o fim da reserva', 'plugs in, we read the battery and adjust the end of the booking')}
              {done.estimatedCostCents !== null && <> — {t('estimado até', 'estimated up to')} {fmtBRL(done.estimatedCostCents)}</>}.
            </p>
          ) : scheduled && done.stationKind === 'PARCEIRO' ? (
            <p>
              {fmtDay(done.startsAt!)} · {fmtTime(done.startsAt!)} {t('às', 'at')} ~{fmtTime(done.endsAt!)}, {t('de', 'from')} {done.startSoc}% {t('a', 'to')} {done.targetSoc}%
              {done.estimatedCostCents !== null && <> — {t('estimado', 'estimated')} {fmtBRL(done.estimatedCostCents)}</>}.
            </p>
          ) : scheduled ? (
            <p>
              {fmtDay(done.startsAt!)} · {fmtTime(done.startsAt!)} {t('às', 'at')} {fmtTime(done.endsAt!)}. {t('Seu', 'Your')} {vehicle.model} {t('sai com', 'leaves with')}{' '}
              {done.targetSoc}%. {t('Custo estimado', 'Estimated cost')} {fmtBRL(done.estimatedCostCents ?? 0)}. {t('O valor final sai da energia medida na sessão.', 'The final amount comes from the energy measured in the session.')}
            </p>
          ) : (
            <p>
              {t('Assim que o', 'As soon as the')} {vehicle.model} {t('plugar no carregador, o Volt escolhe sozinho o horário mais barato pra chegar a', 'plugs into the charger, Volt picks the cheapest time on its own to reach')}{' '}
              {done.targetSoc}% {t('até', 'by')} {fmtDay(done.deadlineAt)} {t('às', 'at')} {fmtTime(done.deadlineAt)}.
            </p>
          )}
          {done.stationName && (
            <div className="done-place">
              {I.pin}
              <span>
                <b>{done.stationName}</b>
                {done.stationAddress && ` · ${done.stationAddress}`}
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <Volt size={84} mood="wink" />
          </div>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setDone(null)
              reset()
            }}
          >
            {t('Fazer outra reserva', 'Make another booking')}
          </button>
        </div>
      </div>
    )
  }

  const confirmNow = () =>
    action.run(async () => {
      const r = await api<Reservation>('/api/reservations/now', {
        method: 'POST',
        json: {
          chargerId: charger.id,
          vehicleId: vehicle.id,
          ...goalParams(goalNow),
        },
      })
      setDone({ ...r, ...placeOf(home) })
      mine.reload()
    })

  const confirmAt = (slot: StartSlot) =>
    action.run(async () => {
      if (!place || !placeChargerId) return
      const r = await api<Reservation>('/api/reservations/at', {
        method: 'POST',
        json: {
          chargerId: placeChargerId,
          vehicleId: vehicle.id,
          ...goalParams(goalLater),
          startsAt: slot.startsAt,
        },
      })
      setDone({ ...r, ...placeOf(place.station) })
      setSlotPick(null)
      mine.reload()
      starts.reload()
    })

  const pickedLabel = activeSlot ? (activeSlot.now ? t('agora', 'now') : `${days[day].w} ${fmtTime(activeSlot.startsAt)}`) : null

  const cancel = (id: string) => {
    if (!confirm(t('Cancelar essa reserva?', 'Cancel this booking?'))) return
    void action.run(async () => {
      await api(`/api/reservations/${id}`, { method: 'DELETE' })
      mine.reload()
    })
  }

  const upcoming = (mine.data ?? [])
    .filter((r) => r.status === 'PENDING_PLUGIN' || (r.status === 'SCHEDULED' && new Date(r.endsAt!).getTime() > nowMs))
    .sort((a, b) => (a.startsAt ?? a.deadlineAt).localeCompare(b.startsAt ?? b.deadlineAt))

  return (
    <div className="screen-anim">
      <div className="screen-title">{t('Agendar recarga', 'Book a charge')}</div>
      <div className="screen-sub">{t('Defina quanto carregar e quando. As horas mais baratas ficam em destaque.', 'Set how much to charge and when. The cheapest hours are highlighted.')}</div>

      {busyByOther && (
        <div className="c">
          <div className="c-label">{t('Carregador do condomínio', "Building's charger")}</div>
          <div className="live-soc" style={{ marginTop: 0 }}>
            <span className="dot" /> <b>{occupant.data!.name}</b> {t('está carregando agora', 'is charging now')}
          </div>
        </div>
      )}

      {!stations.data && (stations.error ? <ErrorBox error={stations.error} /> : <div className="empty-slots">{t('Carregando…', 'Loading…')}</div>)}

      {pluggedIn && (
        <div className="mode-picker">
          <button
            className={`mode-card ${mode === 'now' ? 'on' : ''}`}
            onClick={() => {
              setModePick('now')
              reset()
            }}
          >
            <span className="ic">{I.bolt}</span>
            <span className="t">{t('Já plugado', 'Already plugged in')}</span>
            <span className="s">{t('carro na tomada', 'car is plugged in')}</span>
          </button>
          <button
            className={`mode-card ${mode === 'later' ? 'on' : ''}`}
            onClick={() => {
              setModePick('later')
              reset()
            }}
          >
            <span className="ic">{I.cal}</span>
            <span className="t">{t('Pra depois', 'For later')}</span>
            <span className="s">{t('ainda vou plugar', 'I will plug in later')}</span>
          </button>
        </div>
      )}

      {mode === 'now' && pluggedIn && liveSoc !== null && liveSoc >= 99 && (
        <div className="c">
          <Empty>{t('Seu carro já está com a bateria praticamente cheia', 'Your car battery is almost full')} ({liveSoc}%). {t('Nada pra agendar agora.', 'Nothing to book now.')}</Empty>
        </div>
      )}

      {mode === 'now' && pluggedIn && (liveSoc === null || liveSoc < 99) && (
        <>
          <div className="c">
            <div className="c-label">
              {me.vehicles.length > 1 ? (
                <select className="inline-select" value={vehicle.id} onChange={(e) => (setVehicleId(e.target.value), reset())}>
                  {me.vehicles.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.model}
                    </option>
                  ))}
                </select>
              ) : (
                `${t('Seu carro', 'Your car')} · ${vehicle.model}`
              )}
            </div>
            <BatteryGauge vehicle={vehicle} soc={liveSoc} target={preview?.targetSoc ?? activeTargetNow} go={go} />
            {liveSoc !== null && (
              <div className="live-soc">
                <span className="dot" /> {t('bateria agora', 'battery now')} <b>{socLabel(vehicle, liveSoc)}</b>
              </div>
            )}
            <div className="soc-now-meta">{t('Quanto carregar', 'How much to charge')}</div>
            <GoalPicker
              vehicle={vehicle}
              goal={goalNow}
              fromSoc={liveSoc ?? 20}
              socEnabled={targetsNow}
              priceCentsKwh={nowPriceKwh}
              onPick={setGoal}
            />
          </div>

          <div className="c">
            <div className="c-label">{t('Começa agora', 'Starts now')}</div>
            {!preview && !nowPreview.error && <div className="empty-slots">{t('Calculando…', 'Calculating…')}</div>}
            {nowPreview.error && <ErrorBox error={nowPreview.error} onRetry={nowPreview.reload} />}
            {preview && !preview.window && (
              <div className="empty-slots">{t('O carregador está reservado logo em seguida — escolhe uma meta menor.', 'The charger is reserved right after — pick a smaller target.')}</div>
            )}
            {preview?.window && (
              <div className="confirm-summary">
                <CostHero cents={preview.window.costCents} level={preview.window.level} />
                <div className="row">
                  <span>{t('Carga', 'Charge')}</span>
                  <b>
                    {fmtKwh(preview.energyKwh)}
                    {kmFor(vehicle, preview.energyKwh) !== null && ` · +${kmFor(vehicle, preview.energyKwh)} km`}
                  </b>
                </div>
                <div className="row">
                  <span>{t('Pronto', 'Ready')}</span>
                  <b>
                    {fmtDay(preview.window.end)} {t('às', 'at')} {preview.soc === null ? '~' : ''}
                    {fmtTime(preview.window.end)}
                  </b>
                </div>
              </div>
            )}
          </div>

          {action.error && <div className="login-error">{action.error}</div>}
          <button className="btn btn-primary" onClick={confirmNow} disabled={action.busy || !preview?.window} style={{ width: '100%' }}>
            {action.busy ? t('Iniciando…', 'Starting…') : t('Começar recarga', 'Start charge')}
          </button>
        </>
      )}

      {mode === 'later' && stations.data && places.length === 0 && (
        <ErrorBox error={t('Nenhum carregador disponível pra reserva. Fale com o gestor do condomínio.', 'No charger available to book. Talk to the building manager.')} />
      )}

      {mode === 'later' && place && (
        <>
          <div className="wiz-progress">
            <div className="wiz-bar">
              {WIZARD_LABELS.map((_, i) => (
                <div key={i} className={`wiz-seg ${i <= wizardStep ? 'on' : ''}`} />
              ))}
            </div>
            <div className="wiz-step-label">
              {t('Passo', 'Step')} {wizardStep + 1} {t('de', 'of')} {WIZARD_LABELS.length} · {WIZARD_LABELS[wizardStep]}
            </div>
          </div>

          {wizardStep === 0 && (
            <div className="c">
              <div className="c-label">{t('Onde carregar', 'Where to charge')} · {place.station.name}</div>
              {!places.some((p) => p.own) && (
                <div className="empty-slots" style={{ marginBottom: 10 }}>
                  {t('Sua unidade ainda não tem um carregador de condomínio vinculado — por enquanto só aparecem os parceiros da rede. Fale com o gestor pra vincular.', 'Your unit has no building charger linked yet, so only network partners show up for now. Talk to the manager to link one.')}
                </div>
              )}
              <div className="place-list">
                {places.map((p) => {
                  const s = p.station
                  const power = Math.max(...s.chargers.map((c) => Number(c.maxPowerKw)))
                  const price = p.own
                    ? t('tarifa dinâmica', 'dynamic rate')
                    : s.publicPriceCentsKwh !== null
                      ? `${t('base', 'base')} ${fmtBRL(s.publicPriceCentsKwh)}/kWh`
                      : null
                  return (
                    <button
                      key={s.id}
                      className={`place-card ${p.own ? 'own' : 'partner'} ${s.id === place.station.id ? 'on' : ''}`}
                      onClick={() => pickPlace(s.id)}
                    >
                      <PlacePhoto own={p.own} imageUrl={s.imageUrl} seed={s.id} />
                      <span className="place-body">
                        <span className="place-name">{s.name}</span>
                        <span className="place-addr">
                          {I.pin}
                          {s.address ?? t('endereço não informado', 'address not provided')}
                        </span>
                        <span className="place-meta">
                          {[`${fmtNum(power, 0)} kW`, price, s.openingHours, p.km !== null ? fmtDistance(p.km) : null]
                            .filter(Boolean)
                            .map((t) => <span key={t}>{t}</span>)}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {wizardStep === 1 && (
            <div className="c">
              <div className="c-label">{t('Quando', 'When')} · {pickedLabel ?? t('escolhe um horário', 'pick a time')}</div>
              <div className="day-chips" style={{ marginBottom: 18 }}>
                {days.map((d, i) => {
                  const full = slotsData !== null && !slotsByDay[i].some((s) => s.free)
                  return (
                    <button
                      key={d.start.toISOString()}
                      className={`day-chip ${i === day ? 'on' : ''} ${full ? 'full' : ''}`}
                      onClick={() => {
                        setDayPick(i)
                        setSlotPick(null)
                      }}
                    >
                      <div className="w">{d.w}</div>
                      <div className="n">{d.n}</div>
                    </button>
                  )
                })}
              </div>

              {starts.error && <ErrorBox error={starts.error} />}
              {!starts.error && !slotsData && <div className="empty-slots">{t('Buscando os horários livres…', 'Looking up free times…')}</div>}
              {slotsData && freeDaySlots.length === 0 && (
                <div className="empty-slots">
                  {daySlots.length > 0
                    ? t(`Nenhum horário livre ${day < 2 ? days[day].w : 'nesse dia'} — escolhe outro.`, `No free time ${day < 2 ? days[day].w : 'that day'} — pick another.`)
                    : day === 0
                      ? t('Não dá mais pra começar hoje aqui — escolhe outro dia.', "Can't start today here anymore — pick another day.")
                      : t(`${place.station.name} não abre nesse dia (${place.station.openingHours}).`, `${place.station.name} is closed that day (${place.station.openingHours}).`)}
                </div>
              )}
              {slotsData && activeSlot && freeDaySlots.length > 0 && (
                <div className="time-slider-wrap">
                  <div className="time-slider-bubble" style={{ left: `${sliderPct}%` }}>
                    <span>{activeSlot.now ? t('Agora', 'Now') : fmtTime(activeSlot.startsAt)}</span>
                    {activeSlot.costCents !== null && <span className={`price ${activeSlot.level}`}>{fmtBRL(activeSlot.costCents)}</span>}
                  </div>
                  <input
                    type="range"
                    className="time-slider"
                    min={0}
                    max={freeDaySlots.length - 1}
                    step={1}
                    value={sliderIndex}
                    style={{ background: sliderGradient(freeDaySlots) }}
                    onChange={(e) => setSlotPick(slotKey(freeDaySlots[Number(e.target.value)]))}
                  />
                </div>
              )}

              <div className="wiz-nav">
                <button className="btn btn-ghost" onClick={() => setWizardStep(0)}>
                  {t('Voltar', 'Back')}
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!activeSlot}
                  onClick={() => {
                    if (activeSlot) setSlotPick(slotKey(activeSlot))
                    setWizardStep(2)
                  }}
                >
                  {t('Continuar', 'Continue')}
                </button>
              </div>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="c">
              <div className="c-label">
                {me.vehicles.length > 1 ? (
                  <select className="inline-select" value={vehicle.id} onChange={(e) => setVehicleId(e.target.value)}>
                    {me.vehicles.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.model}
                      </option>
                    ))}
                  </select>
                ) : (
                  `${t('Seu carro', 'Your car')} · ${vehicle.model}`
                )}
              </div>
              <BatteryGauge vehicle={vehicle} soc={null} target={laterSoc} go={go} />
              <div className="soc-now-meta">{t('Quanto carregar', 'How much to charge')}</div>
              <GoalPicker
                vehicle={vehicle}
                goal={goalLater}
                fromSoc={slotsData?.assumedStartSoc ?? 20}
                socEnabled={TARGETS}
                priceCentsKwh={laterPriceKwh}
                onPick={(g) => {
                  // trocar de forma só mostra as opções; tocar num valor avança.
                  // Mantém o horário do passo 1 (o passo 3 avisa se ele não couber com a nova meta)
                  setGoal(g)
                  if (g.kind === goalLater.kind) setWizardStep(3)
                }}
              />
              <div className="wiz-nav">
                <button className="btn btn-ghost" onClick={() => setWizardStep(1)}>
                  {t('Voltar', 'Back')}
                </button>
                <button className="btn btn-primary" onClick={() => setWizardStep(3)}>
                  {t('Continuar', 'Continue')}
                </button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="c">
              <div className="c-label">{t('Confirmar reserva', 'Confirm booking')}</div>
              {(!slotsData || starts.loading) && <div className="empty-slots">{t('Recalculando os horários pro novo alvo de bateria…', 'Recalculating times for the new battery target…')}</div>}
              {slotsData && !starts.loading && !activeSlot && (
                <div className="empty-slots">{t('Nenhum horário livre nesse dia pra essa meta — volta e escolhe outro.', 'No free time that day for this target — go back and pick another.')}</div>
              )}
              {slotsData && !starts.loading && activeSlot && (
                <>
                  {slotPick && !chosen && (
                    <div className="empty-slots" style={{ marginBottom: 12 }}>
                      {t('O horário que você escolheu não cabe mais com essa meta — sugerimos o mais barato do dia.', "The time you picked doesn't fit this target anymore — we suggest the cheapest of the day.")}
                    </div>
                  )}
                  <div className="confirm-summary">
                    {activeSlot.costCents !== null && <CostHero cents={activeSlot.costCents} level={activeSlot.level} />}
                    <div className="row">
                      <span>{t('Local', 'Place')}</span>
                      <b>{place.station.name}</b>
                    </div>
                    <div className="row">
                      <span>{t('Quando', 'When')}</span>
                      <b>
                        {activeSlot.now ? t('Agora', 'Now') : `${fmtDay(activeSlot.startsAt)} · ${fmtTime(activeSlot.startsAt)}`} {t('às', 'at')} ~
                        {fmtTime(activeSlot.endsAt)}
                      </b>
                    </div>
                    {goalLater.kind === 'SOC' ? (
                      <div className="row">
                        <span>{t('Bateria', 'Battery')}</span>
                        <b>
                          {slotsData.socDeclared
                            ? `${slotsData.assumedStartSoc}% → ${socLabel(vehicle, goalLater.value)}`
                            : `${t('meta', 'target')} ${socLabel(vehicle, goalLater.value)}`}
                        </b>
                      </div>
                    ) : (
                      <div className="row">
                        <span>{goalLater.kind === 'BRL' ? `${t('Até', 'Up to')} ${fmtBRL(goalLater.value)}` : t('Carga', 'Charge')}</span>
                        <b>
                          {fmtKwh(activeSlot.energyKwh)}
                          {kmFor(vehicle, activeSlot.energyKwh) !== null && ` · +${kmFor(vehicle, activeSlot.energyKwh)} km`}
                        </b>
                      </div>
                    )}
                  </div>

                  {cheaperAlternatives.length > 0 && (
                    <>
                      <div className="c-label" style={{ marginTop: 16 }}>
                        {t('Horários mais baratos', 'Cheapest times')} {day === 0 ? t('hoje', 'today') : `${t('em', 'on')} ${days[day].w}`}
                      </div>
                      <div className="alt-slots">
                        {cheaperAlternatives.map((s) => (
                          <button key={slotKey(s)} className="alt-slot" onClick={() => setSlotPick(slotKey(s))}>
                            <span className="t">{s.now ? t('Agora', 'Now') : fmtTime(s.startsAt)}</span>
                            {s.costCents !== null && <span className={`est ${s.level}`}>{fmtBRL(s.costCents)}</span>}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
              <div className="wiz-nav">
                <button className="btn btn-ghost" onClick={() => setWizardStep(2)}>
                  {t('Voltar', 'Back')}
                </button>
              </div>
            </div>
          )}

          {action.error && <div className="login-error">{action.error}</div>}
          {wizardStep === 3 && (
            <button
              className="btn btn-primary"
              onClick={() => activeSlot && confirmAt(activeSlot)}
              disabled={action.busy || !activeSlot}
              style={{ width: '100%' }}
            >
              {action.busy ? t('Agendando…', 'Booking…') : pickedLabel ? `${t('Agendar', 'Book')} · ${pickedLabel}` : t('Escolhe um horário', 'Pick a time')}
            </button>
          )}
        </>
      )}

      <div className="c" style={{ marginTop: 18 }}>
        <div className="c-label">{t('Minhas reservas', 'My bookings')}</div>
        {upcoming.length === 0 && <Empty>{t('Nenhuma reserva futura.', 'No upcoming bookings.')}</Empty>}
        <div className="resv-list">
          {upcoming.map((r) => (
            <ReservationCard
              key={r.id}
              r={r}
              action={
                <button className="btn btn-ghost btn-sm" disabled={action.busy} onClick={() => cancel(r.id)}>
                  {t('Cancelar', 'Cancel')}
                </button>
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}
