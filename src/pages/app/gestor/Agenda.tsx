import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fmtBRL, fmtDateTime, fmtDay, fmtKwh, fmtMinutes, fmtNum, fmtTime, fromLocal, LEVEL_LABEL, local, WEEKDAYS } from '../../../lib/format'
import { isEn, list, t } from '../../../lib/i18n'
import { api } from '../../../lib/http'
import type { Agenda as AgendaData, AgendaReservation, AgendaSession, PriceLevel } from '../../../lib/types'
import { useAction } from '../../../lib/useAction'
import { useApi } from '../../../lib/useApi'
import { I } from '../icons'
import { ErrorBox, Loading, Modal, PlateChip } from '../ui'

/**
 * Agenda do condomínio em grade, no jeito do Google Calendar: colunas = dias, linhas = horas.
 * Cada reserva vira um bloco na janela de carga; o trecho em que o carro já ocupa o carregador
 * antes da carga começar (`occupiedFromAt`) aparece hachurado. As sessões reais da SEMS entram
 * como blocos verdes próprios, ao lado do agendamento que atenderam — dá pra bater o agendado
 * com o que aconteceu, ou ver só um dos dois. Cada hora leva a faixa de preço da tarifa dinâmica
 * (barato/normal/pico) numa borda à esquerda do dia, com fundo verde nas baratas e rosa no pico.
 */

const HOUR_PX = 44
const DAY_MS = 86_400_000
const MONTHS_SHORT = list(
  ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
)
/** Uma cor por carregador (só faz diferença em condomínio com mais de um). */
const CHARGER_COLORS = ['#e8185a', '#34d399', '#60a5fa', '#fbbf24', '#a78bfa', '#f472b6']

type View = 'week' | 'day'
type Ymd = { year: number; month: number; day: number }

const ymdOf = (d: Date): Ymd => {
  const l = local(d)
  return { year: l.year, month: l.month, day: l.day }
}
const dayStart = (a: Ymd, plus = 0) => fromLocal(a.year, a.month, a.day + plus)
const minutesInto = (t: Date, start: Date) => (t.getTime() - start.getTime()) / 60_000

type Placed<T> = T & { lane: number; lanes: number }

/** Distribui blocos sobrepostos em faixas lado a lado (como o Google faz com eventos simultâneos). */
function layout<T extends { top: number; bottom: number }>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.top - b.top || b.bottom - a.bottom)
  const out: Placed<T>[] = []
  let cluster: Placed<T>[] = []
  let laneEnds: number[] = []
  let clusterEnd = -Infinity
  const flush = () => {
    for (const c of cluster) c.lanes = laneEnds.length
    out.push(...cluster)
    cluster = []
    laneEnds = []
  }
  for (const it of sorted) {
    if (cluster.length && it.top >= clusterEnd) flush()
    let lane = laneEnds.findIndex((e) => e <= it.top)
    if (lane < 0) lane = laneEnds.push(0) - 1
    laneEnds[lane] = it.bottom
    cluster.push({ ...it, lane, lanes: 0 })
    clusterEnd = cluster.length === 1 ? it.bottom : Math.max(clusterEnd, it.bottom)
  }
  if (cluster.length) flush()
  return out
}

type Span = { top: number; bottom: number; contStart: boolean; contEnd: boolean }
type Item = ({ kind: 'res'; r: AgendaReservation; leadPx: number } | { kind: 'ses'; s: AgendaSession }) & Span

/** Folga pra casar reserva com sessão: o morador pluga um pouco antes ou depois do combinado. */
const MATCH_SLACK_MS = 60 * 60_000

/**
 * A recarga real (SEMS) que atendeu a reserva: mesmo carregador, mesma pessoa (ou sessão ainda
 * sem morador) e sobreposta à janela, com folga de 1h nas pontas. Sem ela, a reserva que já
 * passou é "não realizada".
 */
function matchSessions(reservations: AgendaReservation[], sessions: AgendaSession[], now: Date) {
  const m = new Map<string, AgendaSession>()
  const used = new Set<string>()
  for (const r of reservations) {
    if (r.status !== 'SCHEDULED') continue
    const a = new Date(r.occupiedFromAt ?? r.startsAt!).getTime() - MATCH_SLACK_MS
    const b = new Date(r.endsAt!).getTime() + MATCH_SLACK_MS
    const s = sessions.find(
      (s) =>
        !used.has(s.id) &&
        s.chargerId === r.chargerId &&
        (s.userId === r.userId || s.userId === null) &&
        new Date(s.startedAt).getTime() < b &&
        (s.endedAt ? new Date(s.endedAt) : now).getTime() > a,
    )
    if (s) {
      m.set(r.id, s)
      used.add(s.id)
    }
  }
  return m
}

/** Faixa de preço predominante de uma janela: a média do multiplicador das horas que ela cobre. */
function windowLevel(prices: Map<number, PriceLevel>, start: Date, end: Date): PriceLevel | null {
  const score = { cheap: 0, mid: 1, peak: 2 } as const
  const xs: number[] = []
  for (let t = Math.floor(start.getTime() / 3_600_000) * 3_600_000; t < end.getTime(); t += 3_600_000) {
    const l = prices.get(t)
    if (l) xs.push(score[l])
  }
  if (!xs.length) return null
  const avg = xs.reduce((a, b) => a + b, 0) / xs.length
  return avg < 0.5 ? 'cheap' : avg < 1.5 ? 'mid' : 'peak'
}

type Status = { label: string; cls: string; done?: boolean }

function statusOf(r: AgendaReservation, now: Date, real?: AgendaSession): Status {
  if (r.status === 'CANCELLED') return { label: t('Cancelada', 'Cancelled'), cls: 'cancelled' }
  if (r.status === 'EXPIRED') return { label: t('Expirada', 'Expired'), cls: 'cancelled' }
  if (real && !real.endedAt) return { label: t('Carregando', 'Charging'), cls: 'live' }
  if (new Date(r.endsAt!) <= now)
    return real
      ? { label: t('Realizada', 'Completed'), cls: 'done', done: true }
      : { label: t('Não realizada', 'Missed'), cls: 'missed' }
  if (real) return { label: t('Realizada', 'Completed'), cls: 'done', done: true }
  if (new Date(r.occupiedFromAt ?? r.startsAt!) <= now) return { label: t('Em andamento', 'In progress'), cls: 'live' }
  return { label: t('Agendada', 'Booked'), cls: '' }
}

function rangeLabel(view: View, days: Date[]) {
  if (view === 'day') {
    const l = local(days[0]!)
    return isEn()
      ? `${WEEKDAYS[l.weekday]}, ${MONTHS_SHORT[l.month - 1]} ${l.day}, ${l.year}`
      : `${WEEKDAYS[l.weekday]}, ${l.day} de ${MONTHS_SHORT[l.month - 1]} de ${l.year}`
  }
  const a = local(days[0]!)
  const b = local(days[6]!)
  if (isEn()) {
    if (a.month === b.month) return `${MONTHS_SHORT[a.month - 1]} ${a.day}–${b.day}, ${a.year}`
    return `${MONTHS_SHORT[a.month - 1]} ${a.day} – ${MONTHS_SHORT[b.month - 1]} ${b.day}, ${b.year}`
  }
  if (a.month === b.month) return `${a.day} – ${b.day} de ${MONTHS_SHORT[a.month - 1]} de ${a.year}`
  return `${a.day} ${MONTHS_SHORT[a.month - 1]} – ${b.day} ${MONTHS_SHORT[b.month - 1]} ${b.year}`
}

function Detail({
  r,
  real,
  level,
  chargerName,
  color,
  onClose,
  onCancelled,
}: {
  r: AgendaReservation
  real?: AgendaSession
  level: PriceLevel | null
  chargerName: string
  color: string
  onClose: () => void
  onCancelled: () => void
}) {
  const now = new Date()
  const st = statusOf(r, now, real)
  const act = useAction()
  const [confirming, setConfirming] = useState(false)
  const canCancel = r.status === 'SCHEDULED' && new Date(r.endsAt!) > now
  const cancel = () =>
    void act.run(async () => {
      await api(`/api/reservations/${r.id}`, { method: 'DELETE' })
      onCancelled()
    })

  return (
    <Modal title={t('Agendamento', 'Booking')} onClose={onClose}>
      <div className="ag-detail-head">
        <span className="ag-dot" style={{ background: color }} />
        <div>
          <div className="ag-detail-who">
            {r.userName}
            {r.memberKind === 'CONVIDADO' && <span className="ag-tag">{t('convidado', 'guest')}</span>}
          </div>
          <div className="ag-detail-sub">{r.unitLabel ?? t('sem unidade', 'no unit')} · {chargerName}</div>
        </div>
        <span className={`ag-status ${st.cls}`}>{st.label}</span>
      </div>
      <dl className="ag-kv">
        <dt>{t('Janela de carga', 'Charging window')}</dt>
        <dd>
          {fmtDay(r.startsAt!)} · {fmtTime(r.startsAt!)} – {fmtTime(r.endsAt!)}
          {local(r.startsAt!).day !== local(r.endsAt!).day && ` (${fmtDay(r.endsAt!)})`}
        </dd>
        {st.cls !== 'cancelled' && new Date(r.occupiedFromAt ?? r.startsAt!) <= now && (
          <>
            <dt>{t('Recarga real (SEMS)', 'Actual charge (SEMS)')}</dt>
            <dd>
              {real
                ? `${fmtTime(real.startedAt)} – ${real.endedAt ? fmtTime(real.endedAt) : t('agora', 'now')} · ${fmtKwh(real.energyKwh)}`
                : t('nenhuma sessão na janela', 'no session in the window')}
            </dd>
            {real && real.idleMin > 0 && (
              <>
                <dt>{t('Ociosidade', 'Idle time')}</dt>
                <dd>{fmtMinutes(real.idleMin)} {t('plugado depois da carga', 'plugged in after charging')}</dd>
              </>
            )}
          </>
        )}
        {r.occupiedFromAt && (
          <>
            <dt>{t('Carregador ocupado desde', 'Charger occupied since')}</dt>
            <dd>{fmtDateTime(r.occupiedFromAt)} ({t('carro já plugado', 'car already plugged in')})</dd>
          </>
        )}
        <dt>{t('Carro', 'Car')}</dt>
        <dd className="ag-car">
          {r.vehicleModel ?? '—'}
          {r.vehiclePlate && <PlateChip plate={r.vehiclePlate} />}
        </dd>
        <dt>{t('Bateria', 'Battery')}</dt>
        <dd>
          {r.startSoc !== null ? `${r.startSoc}%` : t('20% (estimado)', '20% (estimated)')} → {r.targetSoc}%
        </dd>
        <dt>{t('Energia prevista', 'Expected energy')}</dt>
        <dd>{r.energyKwh !== null ? fmtKwh(r.energyKwh) : '—'}</dd>
        <dt>{t('Custo estimado', 'Estimated cost')}</dt>
        <dd>{r.estimatedCostCents !== null ? fmtBRL(r.estimatedCostCents) : '—'}</dd>
        {level && (
          <>
            <dt>{t('Faixa de preço', 'Price band')}</dt>
            <dd>
              <span className={`ptag ${level}`}>{LEVEL_LABEL[level]}</span>
            </dd>
          </>
        )}
        <dt>{t('Pronto até', 'Ready by')}</dt>
        <dd>{fmtDateTime(r.deadlineAt)}</dd>
        <dt>{t('Criada em', 'Created on')}</dt>
        <dd>{fmtDateTime(r.createdAt)}</dd>
      </dl>
      {act.error && <div className="login-error">{act.error}</div>}
      {canCancel && (
        <div className="ag-detail-actions">
          {confirming ? (
            <>
              <span className="hint-line">{t('Cancelar a reserva de', 'Cancel the booking for')} {r.userName.split(' ')[0]}?</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={act.busy}>
                {t('Manter', 'Keep')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={cancel} disabled={act.busy}>
                {act.busy ? t('Cancelando…', 'Cancelling…') : t('Sim, cancelar', 'Yes, cancel')}
              </button>
            </>
          ) : (
            <button className="link-btn danger" onClick={() => setConfirming(true)}>
              {t('Cancelar reserva', 'Cancel booking')}
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}

function SessionDetail({
  s,
  booked,
  chargerName,
  onClose,
  onOpenReservation,
}: {
  s: AgendaSession
  booked?: AgendaReservation
  chargerName: string
  onClose: () => void
  onOpenReservation: () => void
}) {
  const end = s.endedAt ? new Date(s.endedAt) : null
  const minutes = s.durationMin ?? Math.round(((end ?? new Date()).getTime() - new Date(s.startedAt).getTime()) / 60_000)
  return (
    <Modal title={t('Sessão realizada', 'Completed session')} onClose={onClose}>
      <div className="ag-detail-head">
        <span className="ag-dot" style={{ background: 'var(--text3)' }} />
        <div>
          <div className="ag-detail-who">{s.userName ?? t('Sem morador atribuído', 'No resident assigned')}</div>
          <div className="ag-detail-sub">{s.unitLabel ?? t('sem unidade', 'no unit')} · {chargerName}</div>
        </div>
        <span className={`ag-status ${end ? 'done' : 'live'}`}>{end ? t('Realizada', 'Completed') : t('Carregando', 'Charging')}</span>
      </div>
      <dl className="ag-kv">
        <dt>{t('Horário', 'Time')}</dt>
        <dd>
          {fmtDay(s.startedAt)} · {fmtTime(s.startedAt)} – {end ? fmtTime(end) : t('agora', 'now')}
          {end && local(s.startedAt).day !== local(end).day && ` (${fmtDay(end)})`}
        </dd>
        <dt>{t('Duração', 'Duration')}</dt>
        <dd>{fmtMinutes(minutes)}</dd>
        <dt>{t('Energia', 'Energy')}</dt>
        <dd>{fmtKwh(s.energyKwh)}</dd>
        {s.idleMin > 0 && (
          <>
            <dt>{t('Ociosidade', 'Idle time')}</dt>
            <dd>{fmtMinutes(s.idleMin)} {t('plugado sem carregar', 'plugged in, not charging')}</dd>
          </>
        )}
        <dt>{t('Valor cobrado', 'Amount charged')}</dt>
        <dd>{s.chargedCents !== null ? fmtBRL(s.chargedCents) : '—'}</dd>
        {s.level && (
          <>
            <dt>{t('Faixa de preço', 'Price band')}</dt>
            <dd>
              <span className={`ptag ${s.level}`}>{LEVEL_LABEL[s.level]}</span>
            </dd>
          </>
        )}
        <dt>{t('Agendamento', 'Booking')}</dt>
        <dd>
          {booked ? (
            <button className="link-btn" onClick={onOpenReservation}>
              {fmtTime(booked.startsAt!)} – {fmtTime(booked.endsAt!)} · {t('ver', 'view')}
            </button>
          ) : (
            t('avulsa (sem agendamento)', 'walk-in (no booking)')
          )}
        </dd>
      </dl>
    </Modal>
  )
}

export default function Agenda() {
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.innerWidth < 700 ? 'day' : 'week'))
  const [anchor, setAnchor] = useState<Ymd>(() => ymdOf(new Date()))
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [openSes, setOpenSes] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  // semana começa na segunda (mesmo corte do backend e da matriz de demanda)
  const firstDay = useMemo(() => {
    if (view === 'day') return anchor
    const wd = local(dayStart(anchor)).weekday
    return ymdOf(dayStart(anchor, -wd))
  }, [view, anchor])
  const nDays = view === 'week' ? 7 : 1
  const days = useMemo(() => Array.from({ length: nDays }, (_, i) => dayStart(firstDay, i)), [firstDay, nDays])
  const from = days[0]!
  const to = dayStart(firstDay, nDays)

  const { data, error, loading, reload } = useApi<AgendaData>(
    `/api/admin/reservations?from=${from.toISOString()}&to=${to.toISOString()}`,
    { pollMs: 60_000 },
  )

  const colorOf = useMemo(() => {
    const m = new Map<string, string>()
    data?.chargers.forEach((c, i) => m.set(c.id, CHARGER_COLORS[i % CHARGER_COLORS.length]!))
    return (id: string) => m.get(id) ?? CHARGER_COLORS[0]!
  }, [data])
  const nameOf = (id: string) => data?.chargers.find((c) => c.id === id)?.stationName ?? 'Carregador'

  const reservations = useMemo(() => (data?.reservations ?? []).filter((r) => !hidden.has(r.chargerId)), [data, hidden])
  const sessions = useMemo(() => (data?.sessions ?? []).filter((s) => !hidden.has(s.chargerId)), [data, hidden])

  const priceByHour = useMemo(() => {
    const m = new Map<number, PriceLevel>()
    for (const p of data?.prices ?? []) m.set(new Date(p.at).getTime(), p.level)
    return m
  }, [data])

  const realOf = useMemo(() => matchSessions(data?.reservations ?? [], data?.sessions ?? [], now), [data, now])
  // sessão → reserva que ela atendeu (as que não atenderam nenhuma são avulsas)
  const bookingOf = useMemo(() => {
    const m = new Map<string, AgendaReservation>()
    for (const r of data?.reservations ?? []) {
      const s = realOf.get(r.id)
      if (s) m.set(s.id, r)
    }
    return m
  }, [data, realOf])

  // recorta cada reserva/sessão nos dias visíveis (uma que vira a noite aparece nos dois dias)
  const perDay = useMemo(
    () =>
      days.map((d0) => {
        const d1 = new Date(d0.getTime() + DAY_MS)
        const items: Item[] = []
        for (const r of reservations) {
          const occ = new Date(r.occupiedFromAt ?? r.startsAt!)
          const s = new Date(r.startsAt!)
          const e = new Date(r.endsAt!)
          if (occ >= d1 || e <= d0) continue
          const a = occ < d0 ? d0 : occ
          const b = e > d1 ? d1 : e
          const top = minutesInto(a, d0)
          const leadEnd = s < a ? a : s > b ? b : s
          items.push({
            kind: 'res',
            r,
            top,
            bottom: Math.max(minutesInto(b, d0), top + 20),
            leadPx: (minutesInto(leadEnd, d0) - top) * (HOUR_PX / 60),
            contStart: occ < d0,
            contEnd: e > d1,
          })
        }
        // sessão que atendeu um agendamento aparece dentro do bloco dele; só a avulsa ganha bloco próprio
        for (const s of sessions) {
          if (bookingOf.has(s.id)) continue
          const a0 = new Date(s.startedAt)
          const b0 = s.endedAt ? new Date(s.endedAt) : now
          if (a0 >= d1 || b0 <= d0) continue
          const top = minutesInto(a0 < d0 ? d0 : a0, d0)
          items.push({
            kind: 'ses',
            s,
            top,
            bottom: Math.max(minutesInto(b0 > d1 ? d1 : b0, d0), top + 20),
            contStart: a0 < d0,
            contEnd: b0 > d1,
          })
        }
        return layout(items)
      }),
    [days, reservations, sessions, now, bookingOf],
  )

  // abre a grade um pouco antes da hora atual (de madrugada, a partir de 0h), não sempre à meia-noite
  const scroller = useRef<HTMLDivElement>(null)
  const scrolled = useRef(false)
  useLayoutEffect(() => {
    if (scrolled.current || !scroller.current) return
    scrolled.current = true
    const h = local(new Date()).hour
    scroller.current.scrollTop = Math.max(0, h - 2) * HOUR_PX
  })

  const step = (dir: -1 | 1) => setAnchor((a) => ymdOf(dayStart(a, dir * nDays)))
  const todayYmd = ymdOf(now)
  const isToday = (d: Date) => {
    const y = ymdOf(d)
    return y.year === todayYmd.year && y.month === todayYmd.month && y.day === todayYmd.day
  }
  const toggleCharger = (id: string) =>
    setHidden((h) => {
      const n = new Set(h)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const active = reservations.filter((r) => r.status === 'SCHEDULED')
  const finished = active.filter((r) => new Date(r.endsAt!) <= now)
  const done = finished.filter((r) => realOf.has(r.id)).length
  const kwh = active.reduce((t, r) => t + (r.energyKwh ?? 0), 0)
  const cents = active.reduce((t, r) => t + (r.estimatedCostCents ?? 0), 0)
  const realKwh = sessions.reduce((t, s) => t + s.energyKwh, 0)
  const walkIns = sessions.filter((s) => !bookingOf.has(s.id)).length
  const open = openId ? data?.reservations.find((r) => r.id === openId) : null
  const openS = openSes ? data?.sessions.find((s) => s.id === openSes) : null

  return (
    <div className="c ag">
      <div className="ag-toolbar">
        <div className="ag-nav">
          <button className="btn btn-ghost ag-today" onClick={() => setAnchor(ymdOf(new Date()))}>
            {t('Hoje', 'Today')}
          </button>
          <button className="ag-arrow" onClick={() => step(-1)} aria-label={t('Anterior', 'Previous')}>
            <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>{I.chevR}</span>
          </button>
          <button className="ag-arrow" onClick={() => step(1)} aria-label={t('Próximo', 'Next')}>
            {I.chevR}
          </button>
          <span className="ag-range">{rangeLabel(view, days)}</span>
        </div>
        <span className="seg ag-seg">
          <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>
            {t('Dia', 'Day')}
          </button>
          <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>
            {t('Semana', 'Week')}
          </button>
        </span>
      </div>

      <div className="ag-summary">
        <span>
          <b>{active.length}</b> {active.length === 1 ? t('agendamento', 'booking') : t('agendamentos', 'bookings')} · <b>{fmtKwh(kwh)}</b> ·{' '}
          <b>{fmtBRL(cents)}</b> {t('estimados', 'estimated')}
        </span>
        {finished.length > 0 && (
          <span>
            <b>
              {done} de {finished.length}
            </b>{' '}
            {t('realizados', 'completed')}
          </span>
        )}
        {walkIns > 0 && (
          <span>
            <b>{walkIns}</b> {walkIns === 1 ? t('recarga avulsa', 'walk-in charge') : t('recargas avulsas', 'walk-in charges')}
          </span>
        )}
        <span>
          <b>{fmtKwh(realKwh)}</b> {t('carregados', 'charged')}
        </span>
      </div>

      {data && data.chargers.length > 1 && (
        <div className="ag-chargers">
          {data.chargers.map((c) => (
            <button key={c.id} className={`ag-charger ${hidden.has(c.id) ? 'off' : ''}`} onClick={() => toggleCharger(c.id)}>
              <span className="ag-dot" style={{ background: colorOf(c.id) }} />
              {c.stationName}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorBox error={error} onRetry={reload} />}
      {loading && !data && <Loading what={t('Montando a agenda', 'Building the schedule')} />}

      <div className={`ag-grid-wrap ${view}`}>
        <div className="ag-head" style={{ gridTemplateColumns: `48px repeat(${nDays}, minmax(0, 1fr))` }}>
          <span />
          {days.map((d) => {
            const l = local(d)
            return (
              <button
                key={d.toISOString()}
                className={`ag-dayhead ${isToday(d) ? 'today' : ''}`}
                onClick={() => {
                  setAnchor(ymdOf(d))
                  setView('day')
                }}
                disabled={view === 'day'}
              >
                <span className="wd">{WEEKDAYS[l.weekday]}</span>
                <span className="dn">{l.day}</span>
              </button>
            )
          })}
        </div>
        <div className="ag-scroll" ref={scroller}>
          <div
            className="ag-body"
            style={{ gridTemplateColumns: `48px repeat(${nDays}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}
          >
            <div className="ag-hours">
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} style={{ top: h * HOUR_PX }}>
                  {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
                </span>
              ))}
            </div>
            {days.map((d0, i) => (
              <div key={d0.toISOString()} className={`ag-col ${isToday(d0) ? 'today' : ''}`}>
                {data?.prices
                    .filter((p) => {
                      const at = new Date(p.at).getTime()
                      return at >= d0.getTime() && at < d0.getTime() + DAY_MS
                    })
                    .map((p) => (
                      <div
                        key={p.at}
                        className={`ag-price ${p.level}`}
                        style={{ top: minutesInto(new Date(p.at), d0) * (HOUR_PX / 60), height: HOUR_PX }}
                        title={`${fmtTime(p.at)} · ${LEVEL_LABEL[p.level]} · R$ ${fmtNum(p.priceCentsKwh / 100, 2)}/kWh`}
                      />
                    ))}
                {perDay[i]!.map((b) => {
                  const h = (b.bottom - b.top) * (HOUR_PX / 60)
                  const box = {
                    top: b.top * (HOUR_PX / 60),
                    height: h - 2,
                    left: `calc(6px + (100% - 8px) * ${b.lane / b.lanes})`,
                    width: `calc((100% - 8px) / ${b.lanes} - 2px)`,
                  }
                  // faixa estreita (semana com blocos lado a lado): só o primeiro nome
                  const narrow = view === 'week' && b.lanes > 1
                  const cont = `${b.contStart ? 'cont-start' : ''} ${b.contEnd ? 'cont-end' : ''}`
                  if (b.kind === 'ses') {
                    const s = b.s
                    const booked = bookingOf.get(s.id)
                    return (
                      <button
                        key={`s-${s.id}`}
                        className={`ag-ev ses ${s.endedAt ? '' : 'live'} ${cont}`}
                        style={box}
                        onClick={() => setOpenSes(s.id)}
                        title={`${t('Sessão realizada', 'Completed session')} · ${s.userName ?? t('sem morador', 'no resident')} · ${fmtTime(s.startedAt)}–${s.endedAt ? fmtTime(s.endedAt) : t('agora', 'now')} · ${fmtKwh(s.energyKwh)}`}
                      >
                        <span className="ag-ev-body">
                          <span className="t">
                            <span className="ag-ok">{I.bolt}</span>
                            {fmtTime(s.startedAt)} – {s.endedAt ? fmtTime(s.endedAt) : t('agora', 'now')}
                          </span>
                          {h >= 34 && (
                            <span className="n">
                              {s.unitLabel && !narrow ? `${s.unitLabel} · ` : ''}
                              {s.userName ? (view === 'week' ? s.userName.split(' ')[0] : s.userName) : t('sem morador', 'no resident')}
                            </span>
                          )}
                          {h >= 58 && (
                            <span className="p">
                              {fmtKwh(s.energyKwh)}
                              {!booked && ` · ${t('avulsa', 'walk-in')}`}
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  }
                  const st = statusOf(b.r, now, realOf.get(b.r.id))
                  return (
                    <button
                      key={b.r.id}
                      className={`ag-ev ${st.cls} ${cont}`}
                      style={{ ...box, ['--ev' as string]: colorOf(b.r.chargerId) }}
                      onClick={() => setOpenId(b.r.id)}
                      title={`${b.r.userName}${b.r.unitLabel ? ` · ${b.r.unitLabel}` : ''} · ${fmtTime(b.r.startsAt!)}–${fmtTime(b.r.endsAt!)}`}
                    >
                      {b.leadPx > 0 && <span className="ag-lead" style={{ height: b.leadPx }} />}
                      <span className="ag-ev-body">
                        <span className="t">
                          {st.done && <span className="ag-ok">{I.check}</span>}
                          {st.cls === 'missed' && <span className="ag-miss">!</span>}
                          {fmtTime(b.r.startsAt!)} – {fmtTime(b.r.endsAt!)}
                        </span>
                        {h >= 34 && (
                          <span className="n">
                            {b.r.unitLabel && !narrow ? `${b.r.unitLabel} · ` : ''}
                            {view === 'week' ? b.r.userName.split(' ')[0] : b.r.userName}
                          </span>
                        )}
                        {h >= 58 && (
                          <span className="p">
                            {realOf.get(b.r.id)
                              ? `${fmtKwh(realOf.get(b.r.id)!.energyKwh)} ${t('carregados', 'charged')}`
                              : b.r.energyKwh !== null
                                ? `${fmtKwh(b.r.energyKwh)} ${t('previstos', 'expected')}`
                                : ''}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
                {isToday(d0) && <div className="ag-now" style={{ top: minutesInto(now, d0) * (HOUR_PX / 60) }} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="heat-legend">
        {(data?.prices.length ?? 0) > 0 && (
          <>
            <span>
              <span className="sw ag-sw-cheap" />
              {t('hora barata', 'cheap hour')}
            </span>
            <span>
              <span className="sw ag-sw-mid" />
              {t('normal', 'normal')}
            </span>
            <span>
              <span className="sw ag-sw-peak" />
              {t('pico', 'peak')}
            </span>
          </>
        )}
        <span>
          <span className="sw" style={{ background: 'var(--pink)' }} />
          {t('agendamento', 'booking')}
        </span>
        <span>
          <span className="sw" style={{ background: 'var(--bg4)', border: '1px solid var(--text3)' }} />
          {t('recarga sem agendamento', 'charge without booking')}
        </span>
      </div>
      <div className="hint-line">
        {t('Toque num agendamento para ver a recarga real e os detalhes. Na semana, toque no dia para abrir só ele.', 'Tap a booking to see the actual charge and details. In the week view, tap a day to open just that one.')}
      </div>

      {open && (
        <Detail
          r={open}
          real={realOf.get(open.id)}
          level={windowLevel(priceByHour, new Date(open.startsAt!), new Date(open.endsAt!))}
          chargerName={nameOf(open.chargerId)}
          color={colorOf(open.chargerId)}
          onClose={() => setOpenId(null)}
          onCancelled={() => {
            setOpenId(null)
            reload()
          }}
        />
      )}
      {openS && (
        <SessionDetail
          s={openS}
          booked={bookingOf.get(openS.id)}
          chargerName={nameOf(openS.chargerId)}
          onClose={() => setOpenSes(null)}
          onOpenReservation={() => {
            setOpenId(bookingOf.get(openS.id)!.id)
            setOpenSes(null)
          }}
        />
      )}
    </div>
  )
}
