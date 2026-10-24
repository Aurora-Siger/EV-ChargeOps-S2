import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fmtBRL, fmtDateTime, fmtDay, fmtKwh, fmtTime, fromLocal, local, WEEKDAYS } from '../../../lib/format'
import { api } from '../../../lib/http'
import type { Agenda as AgendaData, AgendaReservation, AgendaSession } from '../../../lib/types'
import { useAction } from '../../../lib/useAction'
import { useApi } from '../../../lib/useApi'
import { I } from '../icons'
import { ErrorBox, Loading, Modal, PlateChip } from '../ui'

/**
 * Agenda do condomínio em grade, no jeito do Google Calendar: colunas = dias, linhas = horas.
 * Cada reserva vira um bloco na janela de carga; o trecho em que o carro já ocupa o carregador
 * antes da carga começar (`occupiedFromAt`) aparece hachurado. As sessões reais da SEMS correm
 * numa faixa fina à esquerda de cada dia — dá pra bater o agendado com o que aconteceu.
 */

const HOUR_PX = 44
const DAY_MS = 86_400_000
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
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

type ResBlock = { r: AgendaReservation; top: number; bottom: number; leadPx: number; contStart: boolean; contEnd: boolean }
type SesBlock = { s: AgendaSession; top: number; bottom: number }

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

type Status = { label: string; cls: string; done?: boolean }

function statusOf(r: AgendaReservation, now: Date, real?: AgendaSession): Status {
  if (r.status === 'CANCELLED') return { label: 'Cancelada', cls: 'cancelled' }
  if (r.status === 'EXPIRED') return { label: 'Expirada', cls: 'cancelled' }
  if (real && !real.endedAt) return { label: 'Carregando', cls: 'live' }
  if (new Date(r.endsAt!) <= now)
    return real ? { label: 'Realizada', cls: 'done', done: true } : { label: 'Não realizada', cls: 'missed' }
  if (real) return { label: 'Realizada', cls: 'done', done: true }
  if (new Date(r.occupiedFromAt ?? r.startsAt!) <= now) return { label: 'Em andamento', cls: 'live' }
  return { label: 'Agendada', cls: '' }
}

function rangeLabel(view: View, days: Date[]) {
  if (view === 'day') {
    const l = local(days[0]!)
    return `${WEEKDAYS[l.weekday]}, ${l.day} de ${MONTHS_SHORT[l.month - 1]} de ${l.year}`
  }
  const a = local(days[0]!)
  const b = local(days[6]!)
  if (a.month === b.month) return `${a.day} – ${b.day} de ${MONTHS_SHORT[a.month - 1]} de ${a.year}`
  return `${a.day} ${MONTHS_SHORT[a.month - 1]} – ${b.day} ${MONTHS_SHORT[b.month - 1]} ${b.year}`
}

function Detail({
  r,
  real,
  chargerName,
  color,
  onClose,
  onCancelled,
}: {
  r: AgendaReservation
  real?: AgendaSession
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
    <Modal title="Agendamento" onClose={onClose}>
      <div className="ag-detail-head">
        <span className="ag-dot" style={{ background: color }} />
        <div>
          <div className="ag-detail-who">
            {r.userName}
            {r.memberKind === 'CONVIDADO' && <span className="ag-tag">convidado</span>}
          </div>
          <div className="ag-detail-sub">{r.unitLabel ?? 'sem unidade'} · {chargerName}</div>
        </div>
        <span className={`ag-status ${st.cls}`}>{st.label}</span>
      </div>
      <dl className="ag-kv">
        <dt>Janela de carga</dt>
        <dd>
          {fmtDay(r.startsAt!)} · {fmtTime(r.startsAt!)} – {fmtTime(r.endsAt!)}
          {local(r.startsAt!).day !== local(r.endsAt!).day && ` (${fmtDay(r.endsAt!)})`}
        </dd>
        {st.cls !== 'cancelled' && new Date(r.occupiedFromAt ?? r.startsAt!) <= now && (
          <>
            <dt>Recarga real (SEMS)</dt>
            <dd>
              {real
                ? `${fmtTime(real.startedAt)} – ${real.endedAt ? fmtTime(real.endedAt) : 'agora'} · ${fmtKwh(real.energyKwh)}`
                : 'nenhuma sessão na janela'}
            </dd>
          </>
        )}
        {r.occupiedFromAt && (
          <>
            <dt>Carregador ocupado desde</dt>
            <dd>{fmtDateTime(r.occupiedFromAt)} (carro já plugado)</dd>
          </>
        )}
        <dt>Carro</dt>
        <dd className="ag-car">
          {r.vehicleModel ?? '—'}
          {r.vehiclePlate && <PlateChip plate={r.vehiclePlate} />}
        </dd>
        <dt>Bateria</dt>
        <dd>
          {r.startSoc !== null ? `${r.startSoc}%` : '20% (estimado)'} → {r.targetSoc}%
        </dd>
        <dt>Energia prevista</dt>
        <dd>{r.energyKwh !== null ? fmtKwh(r.energyKwh) : '—'}</dd>
        <dt>Custo estimado</dt>
        <dd>{r.estimatedCostCents !== null ? fmtBRL(r.estimatedCostCents) : '—'}</dd>
        <dt>Pronto até</dt>
        <dd>{fmtDateTime(r.deadlineAt)}</dd>
        <dt>Criada em</dt>
        <dd>{fmtDateTime(r.createdAt)}</dd>
      </dl>
      {act.error && <div className="login-error">{act.error}</div>}
      {canCancel && (
        <div className="ag-detail-actions">
          {confirming ? (
            <>
              <span className="hint-line">Cancelar a reserva de {r.userName.split(' ')[0]}?</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} disabled={act.busy}>
                Manter
              </button>
              <button className="btn btn-primary btn-sm" onClick={cancel} disabled={act.busy}>
                {act.busy ? 'Cancelando…' : 'Sim, cancelar'}
              </button>
            </>
          ) : (
            <button className="link-btn danger" onClick={() => setConfirming(true)}>
              Cancelar reserva
            </button>
          )}
        </div>
      )}
    </Modal>
  )
}

export default function Agenda() {
  const [view, setView] = useState<View>(() => (typeof window !== 'undefined' && window.innerWidth < 700 ? 'day' : 'week'))
  const [anchor, setAnchor] = useState<Ymd>(() => ymdOf(new Date()))
  const [withCancelled, setWithCancelled] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
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
    `/api/admin/reservations?from=${from.toISOString()}&to=${to.toISOString()}${withCancelled ? '&cancelled=1' : ''}`,
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

  // recorta cada reserva/sessão nos dias visíveis (uma que vira a noite aparece nos dois dias)
  const perDay = useMemo(
    () =>
      days.map((d0) => {
        const d1 = new Date(d0.getTime() + DAY_MS)
        const res: ResBlock[] = []
        for (const r of reservations) {
          const occ = new Date(r.occupiedFromAt ?? r.startsAt!)
          const s = new Date(r.startsAt!)
          const e = new Date(r.endsAt!)
          if (occ >= d1 || e <= d0) continue
          const a = occ < d0 ? d0 : occ
          const b = e > d1 ? d1 : e
          const top = minutesInto(a, d0)
          const leadEnd = s < a ? a : s > b ? b : s
          res.push({
            r,
            top,
            bottom: Math.max(minutesInto(b, d0), top + 20),
            leadPx: (minutesInto(leadEnd, d0) - top) * (HOUR_PX / 60),
            contStart: occ < d0,
            contEnd: e > d1,
          })
        }
        const ses: SesBlock[] = []
        for (const s of sessions) {
          const a0 = new Date(s.startedAt)
          const b0 = s.endedAt ? new Date(s.endedAt) : now
          if (a0 >= d1 || b0 <= d0) continue
          const top = minutesInto(a0 < d0 ? d0 : a0, d0)
          ses.push({ s, top, bottom: Math.max(minutesInto(b0 > d1 ? d1 : b0, d0), top + 6) })
        }
        return { res: layout(res), ses }
      }),
    [days, reservations, sessions, now],
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

  const realOf = useMemo(() => matchSessions(data?.reservations ?? [], data?.sessions ?? [], now), [data, now])
  const active = reservations.filter((r) => r.status === 'SCHEDULED')
  const finished = active.filter((r) => new Date(r.endsAt!) <= now)
  const done = finished.filter((r) => realOf.has(r.id)).length
  const kwh = active.reduce((t, r) => t + (r.energyKwh ?? 0), 0)
  const cents = active.reduce((t, r) => t + (r.estimatedCostCents ?? 0), 0)
  const open = openId ? data?.reservations.find((r) => r.id === openId) : null

  return (
    <div className="c ag">
      <div className="ag-toolbar">
        <div className="ag-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => setAnchor(ymdOf(new Date()))}>
            Hoje
          </button>
          <button className="ag-arrow" onClick={() => step(-1)} aria-label="Anterior">
            <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>{I.chevR}</span>
          </button>
          <button className="ag-arrow" onClick={() => step(1)} aria-label="Próximo">
            {I.chevR}
          </button>
          <span className="ag-range">{rangeLabel(view, days)}</span>
        </div>
        <div className="ag-nav">
          <label className="check-lbl">
            <input type="checkbox" checked={withCancelled} onChange={(e) => setWithCancelled(e.target.checked)} /> canceladas
          </label>
          <span className="seg">
            <button className={view === 'day' ? 'on' : ''} onClick={() => setView('day')}>
              dia
            </button>
            <button className={view === 'week' ? 'on' : ''} onClick={() => setView('week')}>
              semana
            </button>
          </span>
        </div>
      </div>

      <div className="ag-summary">
        <span>
          <b>{active.length}</b> {active.length === 1 ? 'agendamento' : 'agendamentos'}
        </span>
        <span>
          <b>{fmtKwh(kwh)}</b> previstos
        </span>
        <span>
          <b>{fmtBRL(cents)}</b> estimados
        </span>
        {finished.length > 0 && (
          <span className="ag-sum-done">
            <b>
              {done}/{finished.length}
            </b>{' '}
            realizadas
          </span>
        )}
        {finished.length - done > 0 && (
          <span className="ag-sum-miss">
            <b>{finished.length - done}</b> sem recarga
          </span>
        )}
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
      {loading && !data && <Loading what="Montando a agenda" />}

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
                {perDay[i]!.ses.map((b) => (
                  <div
                    key={b.s.id}
                    className={`ag-ses ${b.s.endedAt ? '' : 'live'}`}
                    style={{ top: b.top * (HOUR_PX / 60), height: (b.bottom - b.top) * (HOUR_PX / 60) }}
                    title={`Recarga real · ${fmtTime(b.s.startedAt)}–${b.s.endedAt ? fmtTime(b.s.endedAt) : 'agora'} · ${fmtKwh(b.s.energyKwh)}${b.s.userName ? ` · ${b.s.userName}` : ''}`}
                  />
                ))}
                {perDay[i]!.res.map((b) => {
                  const st = statusOf(b.r, now, realOf.get(b.r.id))
                  const h = (b.bottom - b.top) * (HOUR_PX / 60)
                  const color = colorOf(b.r.chargerId)
                  return (
                    <button
                      key={b.r.id}
                      className={`ag-ev ${st.cls} ${b.contStart ? 'cont-start' : ''} ${b.contEnd ? 'cont-end' : ''}`}
                      style={{
                        top: b.top * (HOUR_PX / 60),
                        height: h - 2,
                        left: `calc(8px + (100% - 10px) * ${b.lane / b.lanes})`,
                        width: `calc((100% - 10px) / ${b.lanes} - 2px)`,
                        ['--ev' as string]: color,
                      }}
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
                            {b.r.unitLabel ? `${b.r.unitLabel} · ` : ''}
                            {view === 'week' ? b.r.userName.split(' ')[0] : b.r.userName}
                          </span>
                        )}
                        {h >= 58 && b.r.vehiclePlate && <span className="p">{b.r.vehiclePlate}</span>}
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
        <span>
          <span className="sw" style={{ background: 'var(--pink)' }} />
          janela de carga
        </span>
        <span>
          <span className="sw ag-sw-lead" />
          carro plugado esperando a carga
        </span>
        <span>
          <span className="sw" style={{ background: 'var(--green)' }} />
          recarga real (SEMS)
        </span>
        <span>
          <span className="ag-ok">{I.check}</span>
          realizada
        </span>
        <span>
          <span className="ag-miss">!</span>
          não realizada (passou sem recarga)
        </span>
      </div>
      <div className="hint-line">Toque num agendamento para ver os detalhes ou cancelar. Na semana, toque no dia para abrir só ele.</div>

      {open && (
        <Detail
          r={open}
          real={realOf.get(open.id)}
          chargerName={nameOf(open.chargerId)}
          color={colorOf(open.chargerId)}
          onClose={() => setOpenId(null)}
          onCancelled={() => {
            setOpenId(null)
            reload()
          }}
        />
      )}
    </div>
  )
}
