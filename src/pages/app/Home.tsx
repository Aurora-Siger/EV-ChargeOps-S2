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
import { t } from '../../lib/i18n'

const LEVEL_STYLE = { color: 'var(--green)', borderColor: 'var(--green-b)', background: 'var(--green-l)' }

type LiveSession = NonNullable<NonNullable<Station['live']>['session']>

/** Anel de progresso da carga: até a meta quando a bateria é lida; sem ela, um arco girando. */
function ChargeRing({ pct }: { pct: number | null }) {
  const r = 27
  const c = 2 * Math.PI * r
  return (
    <div className={`charge-ring ${pct === null ? 'spin' : ''}`}>
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#f472b6" />
            <stop offset="100%" stopColor="#e8185a" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r={r} className="track" />
        <circle
          cx="32"
          cy="32"
          r={r}
          className="arc"
          strokeDasharray={c}
          strokeDashoffset={pct === null ? c * 0.72 : c * (1 - Math.min(100, Math.max(0, pct)) / 100)}
        />
      </svg>
      <span className="charge-ring-c">{pct === null ? I.bolt : `${pct}%`}</span>
    </div>
  )
}

/**
 * Recarga em andamento: o anel (bateria até a meta, quando lida), quanto já deu em reais e os
 * números da sessão. O valor usa a tarifa desta hora: é uma prévia, o preço final sai no
 * fechamento da sessão.
 */
function LiveCharge({
  session,
  soc,
  targetSoc,
  etaMin,
  priceCentsKwh,
}: {
  session: LiveSession | null
  soc: number | null
  targetSoc: number
  etaMin: number | null
  priceCentsKwh: number | null
}) {
  const facts = [
    session && fmtKwh(session.kwh, 2),
    session && fmtMinutes(session.minutes),
    session?.powerKw != null && `${fmtNum(session.powerKw, 1)} kW`,
  ].filter(Boolean)
  return (
    <div className="live-charge">
      <ChargeRing pct={soc} />
      <div className="live-charge-body">
        <div className="live-charge-k">
          <span className="dot" /> {t('carregando agora', 'charging now')}
          {session && priceCentsKwh !== null && <span className="km">+{fmtNum(session.km, 0)} km</span>}
        </div>
        <div className="live-charge-v">
          {session && priceCentsKwh !== null ? fmtBRL(session.kwh * priceCentsKwh) : session ? `+${fmtNum(session.km, 0)} km` : `${soc}%`}
        </div>
        <div className="live-charge-s">
          {[...facts, etaMin !== null && `${fmtMinutes(etaMin)} ${t('até', 'to')} ${targetSoc}%`]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
    </div>
  )
}

/**
 * Recibo de uma recarga: quando, quanto entrou, a tarifa e o multiplicador da hora, e a
 * ociosidade (minutos plugado depois da carga, se cobrados). Abre tocando na recarga.
 */
const rcptLevel = () => ({ cheap: t('horário barato', 'cheap hours'), mid: t('horário normal', 'normal hours'), peak: t('horário de pico', 'peak hours') })

/** Recibo de uma recarga: total, o que foi carregado e de onde vem cada parte do valor. */
export function Receipt({ s }: { s: Session }) {
  const RCPT_LEVEL = rcptLevel()
  const energyCharged = s.mult !== null && s.energyCostCents !== null ? Math.round(s.mult * s.energyCostCents) : null
  const idleCharged = s.chargedCents !== null && energyCharged !== null ? Math.max(0, s.chargedCents - energyCharged) : 0
  const lines: { k: string; d: string; v: string }[] = [
    {
      k: t('Energia', 'Energy'),
      d:
        s.tariffBaseCentsKwh !== null && s.mult !== null
          ? `${fmtKwh(s.energyKwh, 1)} × ${fmtBRL(s.tariffBaseCentsKwh)} × ${fmtMult(s.mult)}`
          : fmtKwh(s.energyKwh, 1),
      v: energyCharged !== null ? fmtBRL(energyCharged) : '—',
    },
    ...(s.idleMin > 0
      ? [{ k: t('Ocupação da vaga', 'Spot occupancy'), d: `${fmtMinutes(s.idleMin)} ${t('plugado depois de carregar', 'plugged in after charging')}`, v: fmtBRL(idleCharged) }]
      : []),
  ]
  return (
    <div className="rcpt">
      <div className="rcpt-head">
        <span className="rcpt-k">{t('Total da recarga', 'Charge total')}</span>
        <span className="rcpt-total">{s.chargedCents !== null ? fmtBRL(s.chargedCents) : t('em cálculo', 'calculating')}</span>
        <span className="rcpt-when">
          {fmtDay(s.startedAt)}, {fmtTime(s.startedAt)}
          {s.endedAt && ` ${t('às', 'at')} ${fmtTime(s.endedAt)}`}
          {s.level && (
            <span className={`cost-level ${s.level}`}>
              <i />
              {RCPT_LEVEL[s.level]}
            </span>
          )}
        </span>
      </div>
      <div className="rcpt-facts">
        <div>
          <span>{t('Energia', 'Energy')}</span>
          <b>{fmtKwh(s.energyKwh, 1)}</b>
        </div>
        <div>
          <span>{t('Duração', 'Duration')}</span>
          <b>{s.durationMin !== null ? fmtMinutes(s.durationMin) : '—'}</b>
        </div>
        <div>
          <span>{t('Tarifa', 'Rate')}</span>
          <b>{s.mult !== null ? fmtMult(s.mult) : '—'}</b>
        </div>
      </div>
      <div className="rcpt-lines">
        {lines.map((l) => (
          <div className="rcpt-line" key={l.k}>
            <div>
              <div className="t">{l.k}</div>
              <div className="d">{l.d}</div>
            </div>
            <b>{l.v}</b>
          </div>
        ))}
      </div>
      <div className="rcpt-foot">{t('Entra na fatura do mês da sua unidade.', 'Added to your unit’s bill for the month.')}</div>
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
      ? t('Sem telemetria do carregador', 'No charger telemetry')
      : home.free > 0
        ? t('Carregador livre agora', 'Charger free now')
        : t('Carregador em uso agora', 'Charger in use now')

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
          <div className="hi">{t('Oi,', 'Hi,')} {me.user.name.split(' ')[0]} 👋</div>
          <div className="sub">
            {me.workspace?.kind === 'CONVIDADO'
              ? `${t('Convidado', 'Guest')} · ${me.workspace.name}`
              : me.unit
                ? `${me.unit.label}${me.station ? ` · ${me.station.name}` : ''}`
                : me.workspace
                  ? `${me.workspace.name} · ${t('sem unidade vinculada', 'no unit linked')}`
                  : t('Você ainda não participa de nenhum condomínio', "You're not part of any building yet")}
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
            <h2>{t('Bora carregar?', 'Ready to charge?')}</h2>
            <div className="where">
              {home ? `${home.name}${home.address ? ` · ${home.address}` : ''}` : t('Carregador do condomínio', "Building's charger")}
              {now && ` · ${t('agora', 'now')} ${fmtBRL(now.priceCentsKwh)}/kWh (${LEVEL_LABEL[now.level].toLowerCase()})`}
            </div>

            {charging && (session || home?.soc != null) && (
              <LiveCharge
                session={session}
                soc={home?.soc ?? null}
                targetSoc={targetSoc}
                etaMin={etaMin}
                priceCentsKwh={now?.priceCentsKwh ?? null}
              />
            )}

            <button className="btn btn-primary" onClick={() => go('agendar')}>
              {t('Agendar recarga', 'Book a charge')}
            </button>
            <button className="where-change" onClick={() => go('mapa')}>
              {t('ver outros pontos de recarga →', 'see other charging points →')}
            </button>
          </div>

          {cheapest && (
            <div className="best-hour">
              <div className="ic">{I.chart}</div>
              <div className="info">
                <div className="label">{t('Melhor horário pra carregar hoje', 'Best time to charge today')}</div>
                <div className="val">
                  {cheapest === now ? (
                    <b>{t('agora mesmo', 'right now')}</b>
                  ) : (
                    <>
                      {fmtDay(cheapest.at)} {t('às', 'at')} <b>{fmtTime(cheapest.at)}</b>
                    </>
                  )}
                </div>
                <div className="price">{fmtBRL(cheapest.priceCentsKwh)}/kWh · {LEVEL_LABEL[cheapest.level].toLowerCase()}</div>
              </div>
            </div>
          )}

          <div className="c">
            <div className="c-label">{t('Sua próxima reserva', 'Your next booking')}</div>
            {next ? (
              <ReservationCard r={next} />
            ) : (
              <Empty>
                {t('Nenhuma reserva marcada.', 'No bookings yet.')}{' '}
                <button className="link-btn" onClick={() => go('agendar')}>
                  {t('Agendar agora', 'Book now')}
                </button>
              </Empty>
            )}
          </div>
        </div>

        <div>
          <div className="volt-card">
            <Volt size={52} />
            <div className="bubble">
              <div className="who">{t('Volt · seu mês até agora', 'Volt · your month so far')}</div>
              {line && line.sessionsCount > 0 ? (
                <p>
                  {t('Você carregou', "You've charged")} <b>{fmtKwh(line.energyKwh)}</b> {t('em', 'in')} {line.sessionsCount}{' '}
                  {line.sessionsCount === 1 ? t('recarga', 'charge') : t('recargas', 'charges')}
                  {monthSessions.length > 0 && (
                    <>
                      , <span className="good">{offPeak} {t('fora do pico', 'off-peak')}</span>
                    </>
                  )}
                  . {t('A fatura parcial está em', 'The partial bill is at')} <b>{fmtBRL(line.totalCents)}</b>.
                </p>
              ) : (
                <p>{t('Nenhuma recarga sua neste mês ainda.', 'No charges from you this month yet.')}</p>
              )}
              <button className="more" onClick={() => go('fatura')}>
                {t('Ver minha fatura →', 'See my bill →')}
              </button>
            </div>
          </div>

          <div className="c">
            <div className="c-label">{t('Atividade recente', 'Recent activity')}</div>
            {recent.data?.length === 0 && (
              <Empty>
                {t('Nenhuma recarga no seu nome ainda.', 'No charges under your name yet.')}{me.cards.length === 0 && ` ${t('Peça ao gestor para cadastrar seu cartão RFID.', 'Ask the building manager to register your RFID card.')}`}
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
                  <div className="t">{r.level ? `${t('Recarga', 'Charge')} · ${LEVEL_LABEL[r.level].toLowerCase()}` : t('Recarga', 'Charge')}</div>
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
