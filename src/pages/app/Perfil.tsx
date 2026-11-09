import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import logo from '../../assets/logo.png'
import { fmtNum } from '../../lib/format'
import { labels, t } from '../../lib/i18n'
import { api } from '../../lib/http'
import type { JoinRequestStatus, Vehicle } from '../../lib/types'
import { I } from './icons'
import { Empty, Field, Modal } from './ui'
import { initials, isStaff, memberLabel, myRoleLabel, useMe } from './me'
import { useAction } from '../../lib/useAction'
import { VEHICLE_PRESETS, type VehiclePreset } from './vehicleCatalog'

const REQUEST_LABEL: Record<JoinRequestStatus, string> = labels({
  PENDING: ['aguardando o síndico', 'waiting for the building manager'],
  APPROVED: ['aprovado', 'approved'],
  REJECTED: ['recusado', 'declined'],
  CANCELLED: ['cancelado', 'cancelled'],
})

type VehicleForm = { model: string; plate: string; capacityKwh: string; rangeKm: string; maxChargeKw: string }
const EMPTY: VehicleForm = { model: '', plate: '', capacityKwh: '', rangeKm: '', maxChargeKw: '7' }

/** Foto de um modelo do catálogo; cai pro ícone genérico se o link (hotlink externo) não carregar. */
function PresetThumb({ preset }: { preset: VehiclePreset }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="vp-thumb">
      {failed ? I.car : <img src={preset.image} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </div>
  )
}

function VehicleModal({ vehicle, onClose, onSaved }: { vehicle: Vehicle | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<VehicleForm>(
    vehicle
      ? {
          model: vehicle.model,
          plate: vehicle.plate ?? '',
          capacityKwh: String(vehicle.capacityKwh),
          rangeKm: vehicle.rangeKm ? String(vehicle.rangeKm) : '',
          maxChargeKw: String(vehicle.maxChargeKw),
        }
      : EMPTY,
  )
  const { busy, error, run } = useAction()
  const set = (k: keyof VehicleForm) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const num = (v: string) => Number(v.replace(',', '.'))

  const vpRef = useRef<HTMLDivElement>(null)
  const nudge = (dir: 1 | -1) => vpRef.current?.scrollBy({ left: dir * 128, behavior: 'smooth' })

  const pick = (p: VehiclePreset) =>
    setF({
      ...f,
      model: `${p.brand} ${p.model}`,
      capacityKwh: String(p.capacityKwh),
      maxChargeKw: String(p.maxChargeKw),
      rangeKm: String(p.rangeKm),
    })

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const json = {
        model: f.model,
        plate: f.plate.trim() || null,
        capacityKwh: num(f.capacityKwh),
        rangeKm: f.rangeKm ? Math.round(num(f.rangeKm)) : null,
        maxChargeKw: num(f.maxChargeKw),
      }
      await api(vehicle ? `/api/me/vehicles/${vehicle.id}` : '/api/me/vehicles', {
        method: vehicle ? 'PATCH' : 'POST',
        json,
      })
      onSaved()
    })
  }

  return (
    <Modal title={vehicle ? t('Editar veículo', 'Edit vehicle') : t('Cadastrar veículo', 'Add vehicle')} onClose={onClose}>
      <form onSubmit={save}>
        <Field label={t('Modelo mais comum?', 'Common model?')} hint={t('preenche os dados abaixo — pode ajustar depois', 'fills in the data below — you can adjust it later')}>
          <div className="vp-wrap">
            <button type="button" className="strip-nav prev" onClick={() => nudge(-1)} aria-label={t('Modelos anteriores', 'Previous models')}>
              {I.back}
            </button>
            <div className="vp-scroll" ref={vpRef}>
              {VEHICLE_PRESETS.map((p) => (
                <button type="button" key={p.id} className={`vp-card ${f.model === `${p.brand} ${p.model}` ? 'on' : ''}`} onClick={() => pick(p)}>
                  <PresetThumb preset={p} />
                  <span className="vp-name">
                    {p.brand} {p.model}
                  </span>
                </button>
              ))}
            </div>
            <button type="button" className="strip-nav next" onClick={() => nudge(1)} aria-label={t('Próximos modelos', 'Next models')}>
              {I.chevR}
            </button>
          </div>
        </Field>
        <Field label={t('Modelo', 'Model')}>
          <input value={f.model} onChange={set('model')} placeholder="BYD Dolphin" required />
        </Field>
        <div className="form-2">
          <Field label={t('Bateria (kWh)', 'Battery (kWh)')} hint={t('capacidade útil', 'usable capacity')}>
            <input value={f.capacityKwh} onChange={set('capacityKwh')} inputMode="decimal" placeholder="44,9" required />
          </Field>
          <Field label={t('Carga AC máx. (kW)', 'Max AC charging (kW)')} hint={t('carregador embarcado', 'onboard charger')}>
            <input value={f.maxChargeKw} onChange={set('maxChargeKw')} inputMode="decimal" required />
          </Field>
        </div>
        <div className="form-2">
          <Field label={t('Placa', 'Plate')} hint={t('opcional', 'optional')}>
            <input value={f.plate} onChange={set('plate')} placeholder="ABC1D23" maxLength={8} style={{ textTransform: 'uppercase' }} />
          </Field>
          <Field label={t('Autonomia (km)', 'Range (km)')} hint={t('opcional', 'optional')}>
            <input value={f.rangeKm} onChange={set('rangeKm')} inputMode="numeric" placeholder="291" />
          </Field>
        </div>
        {error && <div className="login-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? t('Salvando…', 'Saving…') : t('Salvar', 'Save')}
        </button>
      </form>
    </Modal>
  )
}

/** CPF/CNPJ do pagador: o provedor de cobrança (Asaas) exige para emitir Pix e boleto. */
function DocumentCard() {
  const { me, reloadMe } = useMe()
  const [doc, setDoc] = useState('')
  const [editing, setEditing] = useState(!me.user.hasDocument)
  const act = useAction()

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    void act.run(async () => {
      await api('/api/me/document', { method: 'PUT', json: { cpfCnpj: doc } })
      setDoc('')
      setEditing(false)
      reloadMe()
    })
  }

  return (
    <div className="c">
      <div className="c-label">{t('Dados de cobrança', 'Billing details')}</div>
      {!editing ? (
        <div className="act">
          <div className="ic">{I.card}</div>
          <div className="info">
            <div className="t">{t('CPF/CNPJ informado', 'Tax ID on file')}</div>
            <div className="s">{t('usado para gerar seu Pix e boleto', 'used to generate your Pix and boleto')}</div>
          </div>
          <button className="link-btn" onClick={() => setEditing(true)}>
            {t('alterar', 'change')}
          </button>
        </div>
      ) : (
        <form onSubmit={save}>
          <Field label={t('CPF ou CNPJ', 'Tax ID (CPF or CNPJ)')} hint={t('só números; o gestor só consegue gerar sua cobrança com ele preenchido', 'numbers only; the manager can only generate your charge once it is filled in')}>
            <input value={doc} onChange={(e) => setDoc(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" required />
          </Field>
          {act.error && <div className="login-error">{act.error}</div>}
          <button className="btn btn-primary btn-sm" disabled={act.busy}>
            {act.busy ? t('Salvando…', 'Saving…') : t('Salvar', 'Save')}
          </button>
        </form>
      )}
    </div>
  )
}

export default function Perfil({
  openGestor,
  openMapa,
  onLogout,
  saindo,
}: {
  openGestor: () => void
  openMapa: () => void
  onLogout: () => void
  saindo: boolean
}) {
  const { me, reloadMe, switchWorkspace } = useMe()
  const [editing, setEditing] = useState<Vehicle | 'new' | null>(null)
  const del = useAction()
  const req = useAction()
  const guest = me.workspace?.kind === 'CONVIDADO'
  // aguardando e recusados; aprovado já aparece como condomínio acima
  const requests = me.joinRequests.filter((r) => r.status === 'PENDING' || r.status === 'REJECTED').slice(0, 5)

  const cancelRequest = (id: string) =>
    void req.run(async () => {
      await api(`/api/me/join-requests/${id}`, { method: 'DELETE' })
      reloadMe()
    })

  const remove = (v: Vehicle) => {
    if (!confirm(`${t('Remover', 'Remove')} ${v.model}?`)) return
    void del.run(async () => {
      await api(`/api/me/vehicles/${v.id}`, { method: 'DELETE' })
      reloadMe()
    })
  }

  return (
    <div className="screen-anim">
      <div className="profile-wrap">
        <div className="profile-head">
          <div className="big-avatar">{initials(me.user.name)}</div>
          <div>
            <div className="n">{me.user.name}</div>
            <div className="s">
              {me.user.email} · {myRoleLabel(me)}
            </div>
          </div>
        </div>

        <div className="c">
          <div className="c-label">{me.workspace ? me.workspace.name : t('Minha unidade', 'My unit')}</div>
          <div className="act">
            <div className="ic">{I.home2}</div>
            <div className="info">
              <div className="t">{guest ? t('Convidado neste condomínio', 'Guest in this building') : (me.unit?.label ?? t('Sem unidade vinculada', 'No unit linked'))}</div>
              <div className="s">
                {guest
                  ? t('você paga só o que carregar aqui, sem rateio do custo fixo', 'you only pay for what you charge here, with no fixed-cost split')
                  : me.station
                    ? `${me.station.name}${me.station.address ? ` · ${me.station.address}` : ''}`
                    : t('o síndico vincula sua unidade', 'the building manager links your unit')}
              </div>
            </div>
          </div>
          {me.cards.length === 0 && (
            <div className="act">
              <div className="ic">{I.card}</div>
              <div className="info">
                <div className="t">{t('Nenhum cartão de recarga', 'No charging card')}</div>
                <div className="s">{t('sem cartão, suas recargas só entram na sua fatura se o gestor atribuir', 'without a card, your charges only go on your bill if the manager assigns them')}</div>
              </div>
            </div>
          )}
          {me.cards.map((c) => (
            <div className="act" key={c.id}>
              <div className="ic">{I.card}</div>
              <div className="info">
                <div className="t">{c.label ?? t('Cartão de recarga', 'Charging card')}</div>
                <div className="s">
                  RFID {c.active ? t('ativo', 'active') : t('bloqueado', 'blocked')} · {t('terminação', 'ending in')} {c.cardNumber.slice(-4)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <DocumentCard />

        <div className="c">
          <div className="c-label row-between">
            {t('Meus condomínios', 'My buildings')}
            <button className="link-btn" onClick={openMapa}>
              + {t('pedir acesso', 'request access')}
            </button>
          </div>
          {me.memberships.length === 0 && <Empty>{t('Você ainda não participa de nenhum condomínio.', "You're not part of any building yet.")}</Empty>}
          {me.memberships.map((m) => {
            const active = m.workspaceId === me.workspace?.id
            return (
              <div className="act" key={m.workspaceId}>
                <div className="ic">{I.home2}</div>
                <div className="info">
                  <div className="t">{m.name}</div>
                  <div className="s">
                    {memberLabel(m)}
                    {m.unitLabel ? ` · ${m.unitLabel}` : ''}
                    {active ? ` · ${t('em uso', 'in use')}` : ''}
                  </div>
                </div>
                {!active && (
                  <button className="link-btn" onClick={() => switchWorkspace(m.workspaceId)}>
                    {t('usar', 'use')}
                  </button>
                )}
              </div>
            )
          })}
          {requests.map((r) => (
            <div className="act" key={r.id}>
              <div className="ic">{I.pin}</div>
              <div className="info">
                <div className="t">{r.workspaceName}</div>
                <div className="s">{t('Pedido de acesso', 'Access request')} · {REQUEST_LABEL[r.status]}</div>
              </div>
              {r.status === 'PENDING' && (
                <button className="link-btn danger" onClick={() => cancelRequest(r.id)} disabled={req.busy}>
                  {t('cancelar', 'cancel')}
                </button>
              )}
            </div>
          ))}
          {req.error && <div className="login-error">{req.error}</div>}
          <div className="hint" style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
            {t('Para carregar em outro condomínio, encontre o prédio no mapa e peça acesso ao síndico.', 'To charge at another building, find it on the map and request access from its manager.')}
          </div>
        </div>

        <div className="c">
          <div className="c-label row-between">
            {t('Meus veículos', 'My vehicles')}
            <button className="link-btn" onClick={() => setEditing('new')}>
              + {t('adicionar', 'add')}
            </button>
          </div>
          {me.vehicles.length === 0 && <Empty>{t('Cadastre seu carro para o app calcular tempo e custo da recarga.', 'Add your car so the app can calculate charging time and cost.')}</Empty>}
          {me.vehicles.map((v) => (
            <div className="act" key={v.id}>
              <div className="ic">{I.car}</div>
              <div className="info">
                <div className="t">
                  {v.model}
                  {v.plate && <span className="v-plate"> · {v.plate}</span>}
                </div>
                <div className="s">
                  {fmtNum(v.capacityKwh)} kWh · {t('carga AC até', 'AC charging up to')} {fmtNum(v.maxChargeKw)} kW
                  {v.rangeKm ? ` · ${v.rangeKm} km` : ''}
                </div>
              </div>
              <button className="link-btn" onClick={() => setEditing(v)}>
                {t('editar', 'edit')}
              </button>
              <button className="link-btn danger" onClick={() => remove(v)} disabled={del.busy}>
                {t('remover', 'remove')}
              </button>
            </div>
          ))}
          {del.error && <div className="login-error">{del.error}</div>}
        </div>

        <div className="c" style={{ padding: '6px 18px' }}>
          {isStaff(me) && (
            <button className="p-row" onClick={openGestor}>
              <span className="ic">{I.chart}</span>
              <span className="grow">
                {t('Painel do gestor', 'Manager dashboard')}
                <div className="hint">{t('visão do condomínio inteiro', 'whole-building view')}</div>
              </span>
              <span className="chev">{I.chevR}</span>
            </button>
          )}
          <Link className="p-row" to="/">
            <span className="ic">{I.info}</span>
            <span className="grow">
              {t('Sobre o projeto', 'About the project')}
              <div className="hint">Enterprise Challenge 2026 · GoodWe + FIAP</div>
            </span>
            <span className="chev">{I.chevR}</span>
          </Link>
        </div>

        <button className="btn btn-ghost logout-btn" onClick={onLogout} disabled={saindo}>
          {saindo ? t('Saindo…', 'Signing out…') : t('Sair da conta', 'Sign out')}
        </button>

        <Link to="/" className="c" style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
          <img src={logo} alt="Chargefy" style={{ height: 18, opacity: 0.8 }} />
          <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>{t('voltar para o site', 'back to the website')}</span>
        </Link>
      </div>

      {editing && (
        <VehicleModal
          vehicle={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reloadMe()
          }}
        />
      )}
    </div>
  )
}
