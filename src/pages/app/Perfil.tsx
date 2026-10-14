import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import logo from '../../assets/logo.png'
import { fmtNum } from '../../lib/format'
import { api } from '../../lib/http'
import type { JoinRequestStatus, Vehicle } from '../../lib/types'
import { I } from './icons'
import { Empty, Field, Modal } from './ui'
import { initials, isStaff, memberLabel, myRoleLabel, useMe } from './me'
import { useAction } from '../../lib/useAction'
import { VEHICLE_PRESETS, type VehiclePreset } from './vehicleCatalog'

const REQUEST_LABEL: Record<JoinRequestStatus, string> = {
  PENDING: 'aguardando o síndico',
  APPROVED: 'aprovado',
  REJECTED: 'recusado',
  CANCELLED: 'cancelado',
}

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
    <Modal title={vehicle ? 'Editar veículo' : 'Cadastrar veículo'} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Modelo mais comum?" hint="preenche os dados abaixo — pode ajustar depois">
          <div className="vp-wrap">
            <button type="button" className="strip-nav prev" onClick={() => nudge(-1)} aria-label="Modelos anteriores">
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
            <button type="button" className="strip-nav next" onClick={() => nudge(1)} aria-label="Próximos modelos">
              {I.chevR}
            </button>
          </div>
        </Field>
        <Field label="Modelo">
          <input value={f.model} onChange={set('model')} placeholder="BYD Dolphin" required />
        </Field>
        <div className="form-2">
          <Field label="Bateria (kWh)" hint="capacidade útil">
            <input value={f.capacityKwh} onChange={set('capacityKwh')} inputMode="decimal" placeholder="44,9" required />
          </Field>
          <Field label="Carga AC máx. (kW)" hint="carregador embarcado">
            <input value={f.maxChargeKw} onChange={set('maxChargeKw')} inputMode="decimal" required />
          </Field>
        </div>
        <div className="form-2">
          <Field label="Placa" hint="opcional">
            <input value={f.plate} onChange={set('plate')} placeholder="ABC1D23" maxLength={8} style={{ textTransform: 'uppercase' }} />
          </Field>
          <Field label="Autonomia (km)" hint="opcional">
            <input value={f.rangeKm} onChange={set('rangeKm')} inputMode="numeric" placeholder="291" />
          </Field>
        </div>
        {error && <div className="login-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar'}
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
      <div className="c-label">Dados de cobrança</div>
      {!editing ? (
        <div className="act">
          <div className="ic">{I.card}</div>
          <div className="info">
            <div className="t">CPF/CNPJ informado</div>
            <div className="s">usado para gerar seu Pix e boleto</div>
          </div>
          <button className="link-btn" onClick={() => setEditing(true)}>
            alterar
          </button>
        </div>
      ) : (
        <form onSubmit={save}>
          <Field label="CPF ou CNPJ" hint="só números; o gestor só consegue gerar sua cobrança com ele preenchido">
            <input value={doc} onChange={(e) => setDoc(e.target.value)} inputMode="numeric" placeholder="000.000.000-00" required />
          </Field>
          {act.error && <div className="login-error">{act.error}</div>}
          <button className="btn btn-primary btn-sm" disabled={act.busy}>
            {act.busy ? 'Salvando…' : 'Salvar'}
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
    if (!confirm(`Remover ${v.model}?`)) return
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
          <div className="c-label">{me.workspace ? me.workspace.name : 'Minha unidade'}</div>
          <div className="act">
            <div className="ic">{I.home2}</div>
            <div className="info">
              <div className="t">{guest ? 'Convidado neste condomínio' : (me.unit?.label ?? 'Sem unidade vinculada')}</div>
              <div className="s">
                {guest
                  ? 'você paga só o que carregar aqui, sem rateio do custo fixo'
                  : me.station
                    ? `${me.station.name}${me.station.address ? ` · ${me.station.address}` : ''}`
                    : 'o síndico vincula sua unidade'}
              </div>
            </div>
          </div>
          {me.cards.length === 0 && (
            <div className="act">
              <div className="ic">{I.card}</div>
              <div className="info">
                <div className="t">Nenhum cartão de recarga</div>
                <div className="s">sem cartão, suas recargas só entram na sua fatura se o gestor atribuir</div>
              </div>
            </div>
          )}
          {me.cards.map((c) => (
            <div className="act" key={c.id}>
              <div className="ic">{I.card}</div>
              <div className="info">
                <div className="t">{c.label ?? 'Cartão de recarga'}</div>
                <div className="s">
                  RFID {c.active ? 'ativo' : 'bloqueado'} · terminação {c.cardNumber.slice(-4)}
                </div>
              </div>
            </div>
          ))}
        </div>

        <DocumentCard />

        <div className="c">
          <div className="c-label row-between">
            Meus condomínios
            <button className="link-btn" onClick={openMapa}>
              + pedir acesso
            </button>
          </div>
          {me.memberships.length === 0 && <Empty>Você ainda não participa de nenhum condomínio.</Empty>}
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
                    {active ? ' · em uso' : ''}
                  </div>
                </div>
                {!active && (
                  <button className="link-btn" onClick={() => switchWorkspace(m.workspaceId)}>
                    usar
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
                <div className="s">Pedido de acesso · {REQUEST_LABEL[r.status]}</div>
              </div>
              {r.status === 'PENDING' && (
                <button className="link-btn danger" onClick={() => cancelRequest(r.id)} disabled={req.busy}>
                  cancelar
                </button>
              )}
            </div>
          ))}
          {req.error && <div className="login-error">{req.error}</div>}
          <div className="hint" style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>
            Para carregar em outro condomínio, encontre o prédio no mapa e peça acesso ao síndico.
          </div>
        </div>

        <div className="c">
          <div className="c-label row-between">
            Meus veículos
            <button className="link-btn" onClick={() => setEditing('new')}>
              + adicionar
            </button>
          </div>
          {me.vehicles.length === 0 && <Empty>Cadastre seu carro para o app calcular tempo e custo da recarga.</Empty>}
          {me.vehicles.map((v) => (
            <div className="act" key={v.id}>
              <div className="ic">{I.car}</div>
              <div className="info">
                <div className="t">
                  {v.model}
                  {v.plate && <span className="v-plate"> · {v.plate}</span>}
                </div>
                <div className="s">
                  {fmtNum(v.capacityKwh)} kWh · carga AC até {fmtNum(v.maxChargeKw)} kW
                  {v.rangeKm ? ` · ${v.rangeKm} km` : ''}
                </div>
              </div>
              <button className="link-btn" onClick={() => setEditing(v)}>
                editar
              </button>
              <button className="link-btn danger" onClick={() => remove(v)} disabled={del.busy}>
                remover
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
                Painel do gestor
                <div className="hint">visão do condomínio inteiro</div>
              </span>
              <span className="chev">{I.chevR}</span>
            </button>
          )}
          <Link className="p-row" to="/">
            <span className="ic">{I.info}</span>
            <span className="grow">
              Sobre o projeto
              <div className="hint">Enterprise Challenge 2026 · GoodWe + FIAP</div>
            </span>
            <span className="chev">{I.chevR}</span>
          </Link>
        </div>

        <button className="btn btn-ghost logout-btn" onClick={onLogout} disabled={saindo}>
          {saindo ? 'Saindo…' : 'Sair da conta'}
        </button>

        <Link to="/" className="c" style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
          <img src={logo} alt="Chargefy" style={{ height: 18, opacity: 0.8 }} />
          <span style={{ fontSize: 12.5, color: 'var(--text3)' }}>voltar para o site</span>
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
