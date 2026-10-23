import { useMemo, useState } from 'react'
import Volt from '../../components/Volt'
import { TARGETS, TARGET_USE, availableTargets, chargeRateKw, energyNeeded, rangeAt } from '../../lib/energyPricing'
import { fmtBRL, fmtDay, fmtHours, fmtKwh, fmtNum, fmtTime, fromLocal, LEVEL_LABEL, local, WEEKDAYS } from '../../lib/format'
import { api } from '../../lib/http'
import type { Reservation, StartSlot, StartSlots, Station, Vehicle } from '../../lib/types'
import { useApi } from '../../lib/useApi'
import { distanceKm, fmtDistance, placeholderGradient } from '../../lib/chargePoints'
import { I } from './icons'
import ReservationCard from './ReservationCard'
import { Empty, ErrorBox } from './ui'
import { useMe } from './me'
import { useAction } from '../../lib/useAction'
import type { Tab } from './App'

const DAYS_AHEAD = 7
const HOUR_MS = 3_600_000

/** Hoje + 6 dias, no horário do condomínio. */
function nextDays() {
  const t = local(new Date())
  return Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const start = fromLocal(t.year, t.month, t.day + i)
    const end = fromLocal(t.year, t.month, t.day + i + 1)
    const l = local(start)
    return { start, end, w: i === 0 ? 'hoje' : i === 1 ? 'amanhã' : WEEKDAYS[l.weekday], n: l.day }
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
      <span className={`place-kind ${own ? 'own' : ''}`}>{own ? 'Seu condomínio' : 'Parceiro da rede'}</span>
    </div>
  )
}

type Mode = 'now' | 'later'
type WizardStep = 0 | 1 | 2 | 3
const WIZARD_LABELS = ['Onde', 'Quando', 'Quanto', 'Confirmar']

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
        <span>Capacidade da bateria</span>
        <b>
          {fmtKwh(vehicle.capacityKwh)}
          {km !== null ? ` · ~${km} km cheio` : ''}
        </b>
      </div>
      <div className="batt-bar" role="img" aria-label={`${soc !== null ? `agora ${soc}%, ` : ''}meta ${target}%`}>
        <div className="batt-target" style={{ width: `${target}%` }} />
        {soc !== null && <div className="batt-now" style={{ width: `${soc}%` }} />}
      </div>
      {km === null && (
        <button className="hint-line batt-link" onClick={() => go('perfil')}>
          Cadastra a autonomia do carro no Perfil pra ver a meta em km.
        </button>
      )}
    </div>
  )
}

/** Metas em autonomia do carro cadastrado (km, ou kWh sem autonomia cadastrada), com % e o uso de cada uma como apoio. */
function TargetChips({
  vehicle,
  active,
  enabled,
  onPick,
}: {
  vehicle: Vehicle
  active: number
  enabled: number[]
  onPick: (t: number) => void
}) {
  return (
    <div className="ask-targets" style={{ marginTop: 12, marginBottom: 0 }}>
      {TARGETS.map((t) => {
        const km = rangeAt(vehicle, t)
        return (
          <button key={t} className={`ask-target ${t === active ? 'on' : ''}`} disabled={!enabled.includes(t)} onClick={() => onPick(t)}>
            <b>{km !== null ? `~${km} km` : fmtKwh((t / 100) * vehicle.capacityKwh)}</b>
            <span>
              {t}% · {TARGET_USE[t]}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** "20% · ~56 km" — a bateria informada já traduzida em autonomia. */
function socLabel(vehicle: Vehicle, soc: number) {
  const km = rangeAt(vehicle, soc)
  return km !== null ? `${soc}% · ~${km} km` : `${soc}%`
}

export default function Agendar({ go }: { go: (t: Tab) => void }) {
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
  const [target, setTarget] = useState(80)
  const [hoursNow, setHoursNow] = useState(6)
  // null = ainda não escolheu: abre no primeiro dia com horário livre
  const [dayPick, setDayPick] = useState<number | null>(null)
  const [slotPick, setSlotPick] = useState<string | null>(null)
  // assistente de 3 telas do "agendar pra depois": onde (0) → quando (1) → quanto (2) → confirmar (3)
  const [wizardStep, setWizardStep] = useState<WizardStep>(0)

  const reset = () => {
    setDone(null)
    setWizardStep(0)
  }

  // "já plugado": prazo é daqui a N horas
  const deadlineAtNow = new Date(nowMs + hoursNow * HOUR_MS)

  // Bateria agora (também usada pelo "começar agora" do agendamento, que sempre pergunta).
  const [socNow, setSocNow] = useState(20)
  // Plugado mas sem bateria na telemetria (a GoodWe às vezes só informa a carga): o morador diz quanto tem.
  const liveSoc = telemetrySoc ?? (pluggedIn ? socNow : null)
  const socAsked = pluggedIn && telemetrySoc === null
  const targetsNow = liveSoc !== null ? availableTargets(liveSoc) : []
  const activeTargetNow = targetsNow.includes(target) ? target : (targetsNow[0] ?? 100)
  // Começando "agora", o morador informa a bateria atual (a conta sai dela, não dos 20% assumidos).
  // Horário futuro não pergunta: até lá a bateria muda.
  const startingNow = slotPick === 'now'
  const targetsLater = startingNow ? availableTargets(socNow) : TARGETS
  const activeTargetLater = targetsLater.includes(target) ? target : (targetsLater[0] ?? 100)

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
          targetSoc: String(activeTargetLater),
          from: days[0].start.toISOString(),
          to: days[DAYS_AHEAD - 1].end.toISOString(),
          // só na confirmação: mexer no slider da bateria (passo 2) não refaz a busca a cada toque
          ...(startingNow && wizardStep === 3 ? { startSoc: String(socNow) } : {}),
        })}`
      : null
  const starts = useApi<StartSlots>(slotsPath, { pollMs: 60_000 })
  // trocando de local, a busca anterior não vale mais (o useApi mantém o dado velho enquanto carrega)
  const slotsData = starts.loading ? null : starts.data
  const slotsByDay = days.map((d) =>
    (slotsData?.slots ?? []).filter((s) => {
      const t = new Date(s.startsAt).getTime()
      return t >= d.start.getTime() && t < d.end.getTime()
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
  const cheaperAlternatives = activeSlot?.costCents
    ? daySlots
        .filter((s) => s.free && s !== activeSlot && s.costCents !== null && s.costCents < activeSlot.costCents!)
        .sort((a, b) => a.costCents! - b.costCents!)
        .slice(0, 3)
    : []

  const rate = vehicle && charger ? chargeRateKw(vehicle, charger.maxPowerKw) : 0
  const energyNow = vehicle && liveSoc !== null ? energyNeeded(vehicle, liveSoc, activeTargetNow) : 0

  if (!charger) {
    return (
      <div className="screen-anim">
        <div className="screen-title">Agendar recarga</div>
        <ErrorBox error="Nenhum carregador vinculado à sua unidade. Fale com o gestor do condomínio." />
      </div>
    )
  }

  if (!vehicle) {
    return (
      <div className="screen-anim">
        <div className="screen-title">Agendar recarga</div>
        <div className="screen-sub">Para calcular quanto tempo e quanto custa, o app precisa conhecer o seu carro.</div>
        <div className="c">
          <Empty>Você ainda não cadastrou um veículo.</Empty>
          <button className="btn btn-primary" onClick={() => go('perfil')}>
            Cadastrar meu carro
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
          <h2>{scheduled ? 'Reserva confirmada!' : 'Combinado!'}</h2>
          {scheduled && done.startSoc === null && done.stationKind === 'PARCEIRO' ? (
            <p>
              {fmtDay(done.startsAt!)} · {fmtTime(done.startsAt!)} às ~{fmtTime(done.endsAt!)}, até {done.targetSoc}%
              {done.estimatedCostCents !== null && <> — estimado até {fmtBRL(done.estimatedCostCents)}</>}.
            </p>
          ) : scheduled && done.startSoc === null ? (
            <p>
              {fmtDay(done.startsAt!)} · {fmtTime(done.startsAt!)} às ~{fmtTime(done.endsAt!)}, até {done.targetSoc}%. Quando o{' '}
              {vehicle.model} plugar, a gente lê a bateria e ajusta o fim da reserva
              {done.estimatedCostCents !== null && <> — estimado até {fmtBRL(done.estimatedCostCents)}</>}.
            </p>
          ) : scheduled && done.stationKind === 'PARCEIRO' ? (
            <p>
              {fmtDay(done.startsAt!)} · {fmtTime(done.startsAt!)} às ~{fmtTime(done.endsAt!)}, de {done.startSoc}% a {done.targetSoc}%
              {done.estimatedCostCents !== null && <> — estimado {fmtBRL(done.estimatedCostCents)}</>}.
            </p>
          ) : scheduled ? (
            <p>
              {fmtDay(done.startsAt!)} · {fmtTime(done.startsAt!)} às {fmtTime(done.endsAt!)}. Seu {vehicle.model} sai com{' '}
              {done.targetSoc}%. Custo estimado {fmtBRL(done.estimatedCostCents ?? 0)} — o valor final sai da energia
              medida na sessão.
            </p>
          ) : (
            <p>
              Assim que o {vehicle.model} plugar no carregador, o Volt escolhe sozinho o horário mais barato pra chegar a{' '}
              {done.targetSoc}% até {fmtDay(done.deadlineAt)} às {fmtTime(done.deadlineAt)}.
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
            Fazer outra reserva
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
          targetSoc: activeTargetNow,
          deadlineHours: hoursNow,
          ...(socAsked ? { startSoc: socNow } : {}),
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
          targetSoc: activeTargetLater,
          startsAt: slot.startsAt,
          ...(slot.now && startingNow ? { startSoc: socNow } : {}),
        },
      })
      setDone({ ...r, ...placeOf(place.station) })
      setSlotPick(null)
      mine.reload()
      starts.reload()
    })

  const pickedLabel = activeSlot ? (activeSlot.now ? 'agora' : `${days[day].w} ${fmtTime(activeSlot.startsAt)}`) : null

  const cancel = (id: string) => {
    if (!confirm('Cancelar essa reserva?')) return
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
      <div className="screen-title">Agendar recarga</div>
      <div className="screen-sub">Escolhe onde, a meta e o horário — no prédio, a tarifa dinâmica mostra quais horas saem mais baratas.</div>

      {busyByOther && (
        <div className="c">
          <div className="c-label">Carregador do condomínio</div>
          <div className="live-soc" style={{ marginTop: 0 }}>
            <span className="dot" /> <b>{occupant.data!.name}</b> está carregando agora
          </div>
          <div className="hint-line">Dá pra agendar um horário a seguir; carregar agora só quando ele sair.</div>
        </div>
      )}

      {!stations.data && (stations.error ? <ErrorBox error={stations.error} /> : <div className="empty-slots">Carregando…</div>)}

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
            <span className="t">Já plugado</span>
            <span className="s">carro na tomada agora</span>
          </button>
          <button
            className={`mode-card ${mode === 'later' ? 'on' : ''}`}
            onClick={() => {
              setModePick('later')
              reset()
            }}
          >
            <span className="ic">{I.cal}</span>
            <span className="t">Agendar pra depois</span>
            <span className="s">ainda vou plugar</span>
          </button>
        </div>
      )}

      {mode === 'now' && pluggedIn && liveSoc !== null && liveSoc >= 99 && (
        <div className="c">
          <Empty>Seu carro já está com a bateria praticamente cheia ({liveSoc}%). Nada pra agendar agora.</Empty>
        </div>
      )}

      {mode === 'now' && pluggedIn && liveSoc !== null && liveSoc < 99 && (
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
                `Seu carro · ${vehicle.model}`
              )}
            </div>
            <BatteryGauge vehicle={vehicle} soc={liveSoc} target={activeTargetNow} go={go} />
            {socAsked ? (
              <div className="soc-now">
                <div className="soc-now-head">
                  <span>Bateria agora</span>
                  <b>{socLabel(vehicle, socNow)}</b>
                </div>
                <input
                  className="cc-range"
                  type="range"
                  min={0}
                  max={95}
                  step={5}
                  value={socNow}
                  onChange={(e) => setSocNow(Number(e.target.value))}
                  aria-label="Bateria agora"
                />
                <div className="hint-line">A telemetria não trouxe a bateria do carro: informa quanto ele tem agora.</div>
              </div>
            ) : (
              <div className="live-soc">
                <span className="dot" /> bateria agora <b>{socLabel(vehicle, liveSoc)}</b>
              </div>
            )}
            <div className="soc-now-meta">Quanto de autonomia você quer</div>
            <TargetChips vehicle={vehicle} active={activeTargetNow} enabled={targetsNow} onPick={setTarget} />
            <div className="hint-line">
              faltam {fmtKwh(energyNow)} · carrega a {fmtNum(rate)} kW · {rate > 0 ? fmtHours(energyNow / rate) : '—'} de carga
            </div>
          </div>

          <div className="c">
            <div className="c-label">
              Pronto em até · {fmtDay(deadlineAtNow)} às {fmtTime(deadlineAtNow)}
            </div>
            <input
              className="cc-range"
              type="range"
              min={1}
              max={24}
              step={1}
              value={hoursNow}
              onChange={(e) => setHoursNow(Number(e.target.value))}
            />
            <div className="hint-line">{hoursNow}h a partir de agora</div>
          </div>

          {action.error && <div className="login-error">{action.error}</div>}
          <button className="btn btn-primary" onClick={confirmNow} disabled={action.busy} style={{ width: '100%' }}>
            {action.busy ? 'Reservando…' : 'Confirmar reserva'}
          </button>
        </>
      )}

      {mode === 'later' && stations.data && places.length === 0 && (
        <ErrorBox error="Nenhum carregador disponível pra reserva. Fale com o gestor do condomínio." />
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
              Passo {wizardStep + 1} de {WIZARD_LABELS.length} · {WIZARD_LABELS[wizardStep]}
            </div>
          </div>

          {wizardStep === 0 && (
            <div className="c">
              <div className="c-label">Onde carregar · {place.station.name}</div>
              {!places.some((p) => p.own) && (
                <div className="empty-slots" style={{ marginBottom: 10 }}>
                  Sua unidade ainda não tem um carregador de condomínio vinculado — por enquanto só aparecem os parceiros da rede. Fale com o
                  gestor pra vincular.
                </div>
              )}
              <div className="place-list">
                {places.map((p) => {
                  const s = p.station
                  const power = Math.max(...s.chargers.map((c) => Number(c.maxPowerKw)))
                  const price = p.own
                    ? 'tarifa dinâmica'
                    : s.publicPriceCentsKwh !== null
                      ? `base ${fmtBRL(s.publicPriceCentsKwh)}/kWh`
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
                          {s.address ?? 'endereço não informado'}
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
              <div className="c-label">Quando · {pickedLabel ?? 'escolhe um horário'}</div>
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
              {!starts.error && !slotsData && <div className="empty-slots">Buscando os horários livres…</div>}
              {slotsData && freeDaySlots.length === 0 && (
                <div className="empty-slots">
                  {daySlots.length > 0
                    ? `Nenhum horário livre ${day < 2 ? days[day].w : 'nesse dia'} — escolhe outro.`
                    : day === 0
                      ? 'Não dá mais pra começar hoje aqui — escolhe outro dia.'
                      : `${place.station.name} não abre nesse dia (${place.station.openingHours}).`}
                </div>
              )}
              {slotsData && activeSlot && freeDaySlots.length > 0 && (
                <div className="time-slider-wrap">
                  <div className="time-slider-bubble" style={{ left: `${sliderPct}%` }}>
                    <span>{activeSlot.now ? 'Agora' : fmtTime(activeSlot.startsAt)}</span>
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
                  <div className="hint-line">
                    Arrasta pra escolher o horário — a cor mostra o preço (verde barato, vermelho pico). Segura o carregador por ~
                    {fmtHours(slotsData.hours)}.
                  </div>
                </div>
              )}

              <div className="wiz-nav">
                <button className="btn btn-ghost" onClick={() => setWizardStep(0)}>
                  Voltar
                </button>
                <button
                  className="btn btn-primary"
                  disabled={!activeSlot}
                  onClick={() => {
                    if (activeSlot) setSlotPick(slotKey(activeSlot))
                    setWizardStep(2)
                  }}
                >
                  Continuar
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
                  `Seu carro · ${vehicle.model}`
                )}{' '}
                · {startingNow ? 'bateria e autonomia' : 'quanto de autonomia'}
              </div>
              <BatteryGauge vehicle={vehicle} soc={startingNow ? socNow : null} target={activeTargetLater} go={go} />
              {startingNow && (
                <div className="soc-now">
                  <div className="soc-now-head">
                    <span>Bateria agora</span>
                    <b>{socLabel(vehicle, socNow)}</b>
                  </div>
                  <input
                    className="cc-range"
                    type="range"
                    min={0}
                    max={95}
                    step={5}
                    value={socNow}
                    onChange={(e) => setSocNow(Number(e.target.value))}
                    aria-label="Bateria agora"
                  />
                  <div className="hint-line">Vai começar agora: informa quanto o carro tem de bateria e a conta sai certa.</div>
                  <div className="soc-now-meta">Quanto de autonomia você quer</div>
                </div>
              )}
              {!startingNow && <div className="soc-now-meta">Quanto de autonomia você quer</div>}
              <TargetChips
                vehicle={vehicle}
                active={activeTargetLater}
                enabled={targetsLater}
                onPick={(t) => {
                  // mantém o horário do passo 1 (o passo 3 avisa se ele não couber com a nova meta)
                  setTarget(t)
                  setWizardStep(3)
                }}
              />
              {!place.own && !startingNow && (
                <div className="hint-line">
                  no parceiro não tem telemetria: a conta supõe que o carro chega com {slotsData?.assumedStartSoc ?? 20}%.
                </div>
              )}
              <div className="wiz-nav">
                <button className="btn btn-ghost" onClick={() => setWizardStep(1)}>
                  Voltar
                </button>
              </div>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="c">
              <div className="c-label">Confirmar reserva</div>
              {(!slotsData || starts.loading) && <div className="empty-slots">Recalculando os horários pro novo alvo de bateria…</div>}
              {slotsData && !starts.loading && !activeSlot && (
                <div className="empty-slots">Nenhum horário livre nesse dia pra essa meta — volta e escolhe outro.</div>
              )}
              {slotsData && !starts.loading && activeSlot && (
                <>
                  {slotPick && !chosen && (
                    <div className="empty-slots" style={{ marginBottom: 12 }}>
                      O horário que você escolheu não cabe mais com essa meta — sugerimos o mais barato do dia.
                    </div>
                  )}
                  <div className="confirm-summary">
                    <div className="row">
                      <span>Local</span>
                      <b>{place.station.name}</b>
                    </div>
                    <div className="row">
                      <span>Quando</span>
                      <b>
                        {activeSlot.now ? 'Agora' : `${fmtDay(activeSlot.startsAt)} · ${fmtTime(activeSlot.startsAt)}`} às ~
                        {fmtTime(activeSlot.endsAt)}
                      </b>
                    </div>
                    <div className="row">
                      <span>Bateria</span>
                      <b>
                        {slotsData.socDeclared
                          ? `${slotsData.assumedStartSoc}% → ${socLabel(vehicle, activeTargetLater)}`
                          : `meta ${socLabel(vehicle, activeTargetLater)}`}
                      </b>
                    </div>
                    {activeSlot.costCents !== null && (
                      <div className="row">
                        <span>Estimado</span>
                        <b className={`est ${activeSlot.level}`}>
                          {fmtBRL(activeSlot.costCents)} ({LEVEL_LABEL[activeSlot.level].toLowerCase()})
                        </b>
                      </div>
                    )}
                  </div>
                  <div className="hint-line hint-line-sub">
                    {slotsData.socDeclared
                      ? `Conta feita com a bateria de ${slotsData.assumedStartSoc}% que você informou.`
                      : slotsData.telemetry
                        ? `A conta supõe que o carro chega com ${slotsData.assumedStartSoc}% — quando plugar, a gente lê a bateria e ajusta o fim.`
                        : `A conta supõe que o carro chega com ${slotsData.assumedStartSoc}%.`}
                  </div>
                  {pluggedIn && place.own && !activeSlot.now && (
                    <div className="hint-line hint-line-sub">
                      Seu carro já tá plugado — o carregador fica reservado pra você desde agora até{' '}
                      {fmtTime(activeSlot.endsAt)}, mesmo antes da carga começar.
                    </div>
                  )}

                  {cheaperAlternatives.length > 0 && (
                    <>
                      <div className="c-label" style={{ marginTop: 16 }}>
                        Horários mais baratos {day === 0 ? 'hoje' : `em ${days[day].w}`}
                      </div>
                      <div className="alt-slots">
                        {cheaperAlternatives.map((s) => (
                          <button key={slotKey(s)} className="alt-slot" onClick={() => setSlotPick(slotKey(s))}>
                            <span className="t">{s.now ? 'Agora' : fmtTime(s.startsAt)}</span>
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
                  Voltar
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
              {action.busy ? 'Agendando…' : pickedLabel ? `Agendar · ${pickedLabel}` : 'Escolhe um horário'}
            </button>
          )}
        </>
      )}

      <div className="c" style={{ marginTop: 18 }}>
        <div className="c-label">Minhas reservas</div>
        {upcoming.length === 0 && <Empty>Nenhuma reserva futura.</Empty>}
        <div className="resv-list">
          {upcoming.map((r) => (
            <ReservationCard
              key={r.id}
              r={r}
              action={
                <button className="btn btn-ghost btn-sm" disabled={action.busy} onClick={() => cancel(r.id)}>
                  Cancelar
                </button>
              }
            />
          ))}
        </div>
      </div>
    </div>
  )
}
