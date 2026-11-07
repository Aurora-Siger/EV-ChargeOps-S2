import { Fragment, useState } from 'react'
import Volt from '../../components/Volt'
import { currentPeriod, fmtBRL, fmtDay, fmtKwh, fmtMinutes, fmtMult, fmtNum, fmtTime, LEVEL_LABEL } from '../../lib/format'
import type { MyInvoice, PriceCurve, Reservation, Session, Station } from '../../lib/types'
import { useApi } from '../../lib/useApi'
import { I } from './icons'
import ReservationCard from './ReservationCard'
import { Empty } from './ui'
import { initials, useMe } from './me'
import type { Tab } from './App'

const LEVEL_STYLE = { color: 'var(--green)', borderColor: 'var(--green-b)', background: 'var(--green-l)' }

type LiveSession = NonNullable<NonNullable<Station['live']>['session']>

/**
 * Tempo, energia, quanto já deu em reais e a potência da sessão em andamento. O valor usa a
 * tarifa desta hora: é uma prévia, o preço final sai no fechamento da sessão.
 */
function SessionStats({ session, priceCentsKwh }: { session: LiveSession; priceCentsKwh: number | null }) {
  const cells = [
    { v: fmtMinutes(session.minutes), k: 'tempo' },
    { v: fmtNum(session.kwh, 2), k: 'kWh' },
    ...(priceCentsKwh !== null ? [{ v: fmtBRL(session.kwh * priceCentsKwh), k: 'até agora', money: true }] : []),
    ...(session.powerKw !== null ? [{ v: fmtNum(session.powerKw, 2), k: 'kW agora' }] : []),
  ]
  return (
    <div className="status-live-stats">
      {cells.map((c) => (
        <div key={c.k}>
          <span className={'money' in c ? 'v money' : 'v'}>{c.v}</span>
          <span className="k">{c.k}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Recibo de uma recarga: quando, quanto entrou, a tarifa e o multiplicador da hora, e a
 * ociosidade (minutos plugado depois da carga, se cobrados). Abre tocando na recarga.
 */
function Receipt({ s }: { s: Session }) {
  const energyCharged = s.mult !== null && s.energyCostCents !== null ? Math.round(s.mult * s.energyCostCents) : null
  const idleCharged = s.chargedCents !== null && energyCharged !== null ? Math.max(0, s.chargedCents - energyCharged) : 0
  const rows: [string, string][] = [
    ['Início', `${fmtDay(s.startedAt)} · ${fmtTime(s.startedAt)}`],
    ...(s.endedAt ? [['Fim', `${fmtTime(s.endedAt)}${s.durationMin !== null ? ` · ${fmtMinutes(s.durationMin)}` : ''}`] as [string, string]] : []),
    ['Energia', fmtKwh(s.energyKwh, 2)],
    ...(s.tariffBaseCentsKwh !== null && s.mult !== null
      ? [['Tarifa', `${fmtBRL(s.tariffBaseCentsKwh)}/kWh · ${fmtMult(s.mult)}`] as [string, string]]
      : []),
    ...(energyCharged !== null ? [['Energia cobrada', fmtBRL(energyCharged)] as [string, string]] : []),
    ...(s.idleMin > 0 ? [['Ociosidade', `${fmtMinutes(s.idleMin)}${idleCharged > 0 ? ` · ${fmtBRL(idleCharged)}` : ' · sem custo'}`] as [string, string]] : []),
  ]
  return (
    <div className="receipt">
      {rows.map(([k, v]) => (
        <div className="row" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
      <div className="row total">
        <span>Total</span>
        <b>{s.chargedCents !== null ? fmtBRL(s.chargedCents) : 'em cálculo'}</b>
      </div>
      <div className="receipt-note">entra no rateio do mês da sua unidade</div>
    </div>
  )
}

export default function Home({ go }: { go: (t: Tab) => void }) {
  const { me } = useMe()
  const chargerId = me.charger?.id
  const [nowMs] = useState(() => Date.now())
  const [openReceipt, setOpenReceipt] = useState<string | null>(null)
  const stations = useApi<Station[]>('/api/stations', { pollMs: 60_000 })
  const invoice = useApi<MyInvoice>(`/api/me/invoice?period=${currentPeriod()}`)
  const recent = useApi<Session[]>('/api/me/sessions?limit=3')
  const reservations = useApi<Reservation[]>('/api/me/reservations')
  const curve = useApi<PriceCurve>(chargerId ? `/api/pricing/curve?chargerId=${chargerId}&hours=24` : null)

  const home =
    stations.data?.find((s) => s.chargers.some((c) => c.id === chargerId)) ??
    stations.data?.find((s) => s.kind === 'CONDOMINIO') ??
    null
  const next = reservations.data
    ?.filter((r) => r.status === 'PENDING_PLUGIN' || (r.status === 'SCHEDULED' && new Date(r.endsAt!).getTime() > nowMs))
    .sort((a, b) => (a.startsAt ?? a.deadlineAt).localeCompare(b.startsAt ?? b.deadlineAt))[0]

  const now = curve.data?.hours[0]
  const cheapest = curve.data?.hours.reduce((a, b) => (b.priceCentsKwh < a.priceCentsKwh ? b : a))
  const line = invoice.data?.line
  const monthSessions = invoice.data?.sessions ?? []
  const offPeak = monthSessions.filter((s) => s.level && s.level !== 'peak').length

  const statusText =
    home?.free === null || !home
      ? 'Sem telemetria do carregador'
      : home.free > 0
        ? 'Carregador livre agora'
        : 'Carregador em uso agora'

  // "sessão ativa agora" — só quando a telemetria realmente mostra corrente fluindo, não só
  // carro plugado parado (ver isOccupied em sems.service.ts pro caso mais amplo).
  const charging = !!(home?.pluggedIn && home.live && (home.live.status === 'charging' || home.live.workState === 'charging'))
  const session = charging ? home?.live?.session ?? null : null
  const vehicle = me.vehicles[0]
  const activeNow = next?.status === 'SCHEDULED' && !!next.startsAt && new Date(next.startsAt).getTime() <= nowMs
  const targetSoc = activeNow ? next!.targetSoc : 100
  const chargePowerKw = vehicle ? Math.min(me.charger?.maxPowerKw ?? vehicle.maxChargeKw, vehicle.maxChargeKw) : null
  const etaMin =
    charging && vehicle && chargePowerKw && home?.soc != null && targetSoc > home.soc
      ? Math.round(((vehicle.capacityKwh * (targetSoc - home.soc)) / 100 / chargePowerKw) * 60)
      : null

  return (
    <div className="screen-anim">
      <div className="app-greet">
        <div>
          <div className="hi">Oi, {me.user.name.split(' ')[0]} 👋</div>
          <div className="sub">
            {me.workspace?.kind === 'CONVIDADO'
              ? `Convidado · ${me.workspace.name}`
              : me.unit
                ? `${me.unit.label}${me.station ? ` · ${me.station.name}` : ''}`
                : me.workspace
                  ? `${me.workspace.name} · sem unidade vinculada`
                  : 'Você ainda não participa de nenhum condomínio'}
          </div>
        </div>
        <div className="app-avatar">{initials(me.user.name)}</div>
      </div>

      <div className="desk-cols">
        <div>
          <div className={`status-card ${home?.free === 0 ? 'busy' : ''}`}>
            <div className="shine" />
            <span className="st">
              <span className="dot" /> {statusText}
            </span>
            <h2>Bora carregar?</h2>
            <div className="where">
              {home ? `${home.name}${home.address ? ` · ${home.address}` : ''}` : 'Carregador do condomínio'}
              {now && ` · agora ${fmtBRL(now.priceCentsKwh)}/kWh (${LEVEL_LABEL[now.level].toLowerCase()})`}
            </div>

            {charging && home?.soc == null && session && (
              <div className="status-live">
                <div className="status-live-row">
                  <span className="status-live-num">{fmtNum(session.km)} km</span>
                  <span className="status-live-label">autonomia ganha · carregando agora</span>
                </div>
                <SessionStats session={session} priceCentsKwh={now?.priceCentsKwh ?? null} />
              </div>
            )}

            {charging && home?.soc != null && (
              <div className="status-live">
                <div className="status-live-row">
                  <span className="status-live-num">{home.soc}%</span>
                  <span className="status-live-label">
                    carregando agora
                    {etaMin !== null && ` · ${fmtMinutes(etaMin)} até ${targetSoc}%`}
                  </span>
                </div>
                <div className="status-live-bar">
                  <div className="fill" style={{ width: `${home.soc}%` }} />
                </div>
                {session && <SessionStats session={session} priceCentsKwh={now?.priceCentsKwh ?? null} />}
              </div>
            )}

            <button className="btn btn-primary" onClick={() => go('agendar')}>
              Agendar recarga
            </button>
            <button className="where-change" onClick={() => go('mapa')}>
              ver outros pontos de recarga →
            </button>
          </div>

          {cheapest && (
            <div className="best-hour">
              <div className="ic">{I.chart}</div>
              <div className="info">
                <div className="label">Melhor horário pra carregar hoje</div>
                <div className="val">
                  {cheapest === now ? (
                    <b>agora mesmo</b>
                  ) : (
                    <>
                      {fmtDay(cheapest.at)} às <b>{fmtTime(cheapest.at)}</b>
                    </>
                  )}
                </div>
                <div className="price">{fmtBRL(cheapest.priceCentsKwh)}/kWh · {LEVEL_LABEL[cheapest.level].toLowerCase()}</div>
              </div>
            </div>
          )}

          <div className="c">
            <div className="c-label">Sua próxima reserva</div>
            {next ? (
              <ReservationCard r={next} />
            ) : (
              <Empty>
                Nenhuma reserva marcada.{' '}
                <button className="link-btn" onClick={() => go('agendar')}>
                  Agendar agora
                </button>
              </Empty>
            )}
          </div>
        </div>

        <div>
          <div className="volt-card">
            <Volt size={52} />
            <div className="bubble">
              <div className="who">Volt · seu mês até agora</div>
              {line && line.sessionsCount > 0 ? (
                <p>
                  Você carregou <b>{fmtKwh(line.energyKwh)}</b> em {line.sessionsCount}{' '}
                  {line.sessionsCount === 1 ? 'recarga' : 'recargas'}
                  {monthSessions.length > 0 && (
                    <>
                      , <span className="good">{offPeak} fora do pico</span>
                    </>
                  )}
                  . A fatura parcial está em <b>{fmtBRL(line.totalCents)}</b>.
                </p>
              ) : (
                <p>Nenhuma recarga sua neste mês ainda.</p>
              )}
              <button className="more" onClick={() => go('fatura')}>
                Ver minha fatura →
              </button>
            </div>
          </div>

          <div className="c">
            <div className="c-label">Atividade recente</div>
            {recent.data?.length === 0 && (
              <Empty>
                Nenhuma recarga no seu nome ainda.{me.cards.length === 0 && ' Peça ao gestor para cadastrar seu cartão RFID.'}
              </Empty>
            )}
            {recent.data?.map((r) => (
              <Fragment key={r.id}>
              <button
                className={`act act-btn ${openReceipt === r.id ? 'open' : ''}`}
                aria-expanded={openReceipt === r.id}
                onClick={() => setOpenReceipt(openReceipt === r.id ? null : r.id)}
              >
                <div className="ic" style={r.level === 'cheap' ? LEVEL_STYLE : undefined}>
                  {I.bolt}
                </div>
                <div className="info">
                  <div className="t">{r.level ? `Recarga · ${LEVEL_LABEL[r.level].toLowerCase()}` : 'Recarga'}</div>
                  <div className="s">
                    {fmtDay(r.startedAt)} · {fmtTime(r.startedAt)} · {fmtKwh(r.energyKwh)}
                  </div>
                </div>
                <div className="val">{r.chargedCents !== null ? fmtBRL(r.chargedCents) : '—'}</div>
              </button>
              {openReceipt === r.id && <Receipt s={r} />}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
