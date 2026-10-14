import { useState } from 'react'
import { api } from '../../../lib/http'
import type { AdminTitle, AdminUser, Card, MemberKind, MemberRole, Station, StationKind, Unit, WorkspaceSummary } from '../../../lib/types'
import { useApi } from '../../../lib/useApi'
import { Empty, ErrorBox, Field, Loading, Modal } from '../ui'
import { isSuperAdmin, memberLabel, TITLE_LABEL, useMe } from '../me'
import { useAction } from '../../../lib/useAction'
import { MapPicker } from './MapPicker'

type Sub = 'moradores' | 'unidades' | 'cartoes' | 'estacoes'
const SUBS: { id: Sub; label: string }[] = [
  { id: 'moradores', label: 'Moradores' },
  { id: 'unidades', label: 'Unidades' },
  { id: 'cartoes', label: 'Cartões RFID' },
  { id: 'estacoes', label: 'Pontos de recarga' },
]

const KIND_LABEL: Record<StationKind, string> = { CONDOMINIO: 'Condomínio', PARCEIRO: 'Parceiro', PUBLICO: 'Público' }

const toCents = (v: string) => (v.trim() === '' ? null : Math.round(Number(v.replace(',', '.')) * 100))
const fromCents = (v: number | null) => (v === null ? '' : (v / 100).toFixed(2).replace('.', ','))
const toNum = (v: string) => (v.trim() === '' ? null : Number(v.replace(',', '.')))

/* ── moradores ── */

/** Papel no formulário: morador comum ou um dos cargos de admin (síndico/subsíndico). */
type Papel = 'USER' | AdminTitle
const PAPEIS: Papel[] = ['USER', 'SINDICO', 'SUBSINDICO']
const papelLabel = (p: Papel) => (p === 'USER' ? 'Morador' : TITLE_LABEL[p])
const papelOf = (u: { role: MemberRole; adminTitle: AdminTitle | null }): Papel =>
  u.role === 'ADMIN' && u.adminTitle ? u.adminTitle : 'USER'
const toRole = (p: Papel) => (p === 'USER' ? { role: 'USER' as const, adminTitle: null } : { role: 'ADMIN' as const, adminTitle: p })

type UserForm = { name: string; email: string; password: string; papel: Papel; kind: MemberKind; unitId: string; cpfCnpj: string }

/**
 * Cadastro e edição de alguém do condomínio. Só o superadmin escolhe síndico/subsíndico; o
 * síndico cadastra moradores. Nome e senha de convidado (a conta é do prédio dele) ficam com
 * ele: só o superadmin muda. Manda só o que mudou: o servidor confere cada campo.
 */
function UserModal({ user, units, onClose, onSaved }: { user: AdminUser | null; units: Unit[]; onClose: () => void; onSaved: () => void }) {
  const { me } = useMe()
  const superAdmin = isSuperAdmin(me)
  const self = user?.id === me.user.id
  const [f, setF] = useState<UserForm>({
    name: user?.name ?? '',
    email: user?.email ?? '',
    password: '',
    papel: user ? papelOf(user) : 'USER',
    kind: user?.kind ?? 'MORADOR',
    unitId: user?.unitId ?? '',
    cpfCnpj: '',
  })
  const { busy, error, run } = useAction()
  const set = (k: keyof UserForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value })
  const accountLocked = !!user && !superAdmin && !self && user.kind === 'CONVIDADO'
  const guest = f.kind === 'CONVIDADO'

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const unitId = guest ? null : f.unitId || null
      if (user) {
        const papel = papelOf(user) !== f.papel ? toRole(f.papel) : {}
        await api(`/api/admin/users/${user.id}`, {
          method: 'PATCH',
          json: {
            ...(f.name !== user.name && { name: f.name }),
            ...papel,
            ...(f.kind !== user.kind && { kind: f.kind }),
            ...(unitId !== user.unitId && { unitId }),
            ...(f.password && { password: f.password }),
            ...(f.cpfCnpj && { cpfCnpj: f.cpfCnpj }),
          },
        })
      } else {
        await api('/api/admin/users', {
          method: 'POST',
          json: { name: f.name, email: f.email, password: f.password, ...toRole(f.papel), unitId },
        })
      }
      onSaved()
    })
  }

  return (
    <Modal title={user ? 'Editar pessoa' : 'Cadastrar pessoa'} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Nome" hint={accountLocked ? 'a conta é de outro condomínio: só a própria pessoa muda' : undefined}>
          <input value={f.name} onChange={set('name')} required disabled={accountLocked} />
        </Field>
        <Field label="E-mail">
          <input type="email" value={f.email} onChange={set('email')} required disabled={!!user} />
        </Field>
        {!accountLocked && (
          <Field label={user ? 'Nova senha' : 'Senha inicial'} hint={user ? 'deixe em branco para manter' : 'mínimo 8 caracteres; a pessoa usa para entrar'}>
            <input value={f.password} onChange={set('password')} minLength={8} required={!user} autoComplete="new-password" />
          </Field>
        )}
        {superAdmin && !self && (
          <Field label="Papel" hint="síndico e subsíndico administram o condomínio; um de cada">
            <select value={f.papel} onChange={set('papel')}>
              {PAPEIS.map((p) => (
                <option key={p} value={p}>
                  {papelLabel(p)}
                </option>
              ))}
            </select>
          </Field>
        )}
        {user && (
          <Field
            label="CPF ou CNPJ"
            hint={user.hasDocument ? 'já informado; preencha só para trocar' : 'necessário para gerar o Pix e o boleto desta pessoa'}
          >
            <input value={f.cpfCnpj} onChange={set('cpfCnpj')} inputMode="numeric" placeholder={user.hasDocument ? '••••••••••• (informado)' : '000.000.000-00'} />
          </Field>
        )}
        <div className="form-2">
          {user && (
            <Field label="Tipo">
              <select value={f.kind} onChange={set('kind')}>
                <option value="MORADOR">Morador (tem unidade)</option>
                <option value="CONVIDADO">Convidado (mora em outro)</option>
              </select>
            </Field>
          )}
          <Field label="Unidade">
            <select value={guest ? '' : f.unitId} onChange={set('unitId')} disabled={guest}>
              <option value="">— nenhuma —</option>
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
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

function Moradores() {
  const { me } = useMe()
  const users = useApi<AdminUser[]>('/api/admin/users')
  const units = useApi<Unit[]>('/api/admin/units')
  const [editing, setEditing] = useState<AdminUser | 'new' | null>(null)
  const act = useAction()
  const superAdmin = isSuperAdmin(me)
  // síndico cuida dos moradores e de si; outro admin é com o superadmin
  const canEdit = (u: AdminUser) => superAdmin || u.role === 'USER' || u.id === me.user.id
  const canRemove = (u: AdminUser) => (superAdmin || u.role === 'USER') && u.id !== me.user.id

  const remove = (u: AdminUser) => {
    const msg =
      u.kind === 'CONVIDADO'
        ? `Tirar ${u.name} deste condomínio? A pessoa continua com a conta no condomínio dela.`
        : `Remover ${u.name} deste condomínio? Se a pessoa não participar de outro, a conta e as faturas dela são apagadas.`
    if (!confirm(msg)) return
    void act.run(async () => {
      await api(`/api/admin/users/${u.id}`, { method: 'DELETE' })
      users.reload()
    })
  }

  if (users.loading && !users.data) return <Loading />
  if (users.error) return <ErrorBox error={users.error} onRetry={users.reload} />

  return (
    <div className="c">
      <div className="c-label row-between">
        {users.data?.length ?? 0} pessoas com acesso
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          + Cadastrar
        </button>
      </div>
      {act.error && <div className="login-error">{act.error}</div>}
      {users.data?.map((u) => (
        <div className="act wrap" key={u.id}>
          <div className="info">
            <div className="t">
              {u.name} {u.id === me.user.id && <small>(você)</small>}
            </div>
            <div className="s">
              {u.email} · {u.kind === 'CONVIDADO' ? 'mora em outro condomínio' : (u.unitLabel ?? 'sem unidade')} ·{' '}
              {u.cards.length} {u.cards.length === 1 ? 'cartão' : 'cartões'}{!u.hasDocument && ' · sem CPF/CNPJ'}
            </div>
          </div>
          <span className={`ptag ${u.role === 'USER' ? 'dim' : 'mid'}`}>{memberLabel(u)}</span>
          {canEdit(u) && (
            <button className="link-btn" onClick={() => setEditing(u)}>
              editar
            </button>
          )}
          {canRemove(u) && (
            <button className="link-btn danger" onClick={() => remove(u)} disabled={act.busy}>
              remover
            </button>
          )}
        </div>
      ))}
      {editing && (
        <UserModal
          user={editing === 'new' ? null : editing}
          units={units.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            users.reload()
            units.reload()
          }}
        />
      )}
    </div>
  )
}

/* ── unidades ── */

function Unidades() {
  const { me } = useMe()
  const units = useApi<Unit[]>('/api/admin/units')
  const stations = useApi<Station[]>('/api/stations')
  const [label, setLabel] = useState('')
  const [stationId, setStationId] = useState('')
  const act = useAction()
  // só as estações deste condomínio
  const condos = stations.data?.filter((s) => s.kind === 'CONDOMINIO' && s.workspace?.id === me.workspace?.id) ?? []

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    void act.run(async () => {
      await api('/api/admin/units', { method: 'POST', json: { label, stationId: stationId || condos[0]?.id || null } })
      setLabel('')
      units.reload()
    })
  }
  const update = (id: string, json: object) =>
    act.run(async () => {
      await api(`/api/admin/units/${id}`, { method: 'PATCH', json })
      units.reload()
    })
  const remove = (u: Unit) => {
    if (!confirm(`Apagar ${u.label}? Os moradores dela ficam sem unidade.`)) return
    void act.run(async () => {
      await api(`/api/admin/units/${u.id}`, { method: 'DELETE' })
      units.reload()
    })
  }

  return (
    <div className="c">
      <form className="inline-form" onSubmit={add}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Apto 1204" required />
        <select value={stationId} onChange={(e) => setStationId(e.target.value)} aria-label="Carregador da unidade">
          {condos.length === 0 && <option value="">sem carregador</option>}
          {condos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary btn-sm" disabled={act.busy}>
          Adicionar
        </button>
      </form>
      {act.error && <div className="login-error">{act.error}</div>}
      {units.loading && !units.data && <Loading />}
      {units.data?.length === 0 && <Empty>Nenhuma unidade cadastrada.</Empty>}
      {units.data?.map((u) => (
        <div className="act wrap" key={u.id}>
          <div className="info">
            <div className="t">{u.label}</div>
            <div className="s">
              {u.residents} {u.residents === 1 ? 'morador' : 'moradores'}
            </div>
          </div>
          <select
            className="inline-select"
            value={u.stationId ?? ''}
            onChange={(e) => update(u.id, { stationId: e.target.value || null })}
            aria-label={`Carregador de ${u.label}`}
          >
            <option value="">— sem carregador —</option>
            {condos.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="link-btn danger" onClick={() => remove(u)} disabled={act.busy}>
            apagar
          </button>
        </div>
      ))}
    </div>
  )
}

/* ── cartões ── */

function Cartoes() {
  const cards = useApi<Card[]>('/api/admin/cards')
  const users = useApi<AdminUser[]>('/api/admin/users')
  const [f, setF] = useState({ cardNumber: '', userId: '', label: '' })
  const act = useAction()

  const add = (e: React.FormEvent) => {
    e.preventDefault()
    void act.run(async () => {
      await api('/api/admin/cards', { method: 'POST', json: { ...f, label: f.label || null } })
      setF({ cardNumber: '', userId: f.userId, label: '' })
      cards.reload()
    })
  }
  const toggle = (c: Card) =>
    act.run(async () => {
      await api(`/api/admin/cards/${c.id}`, { method: 'PATCH', json: { active: !c.active } })
      cards.reload()
    })
  const remove = (c: Card) => {
    if (!confirm(`Remover o cartão ${c.cardNumber}? As sessões já atribuídas continuam com o morador.`)) return
    void act.run(async () => {
      await api(`/api/admin/cards/${c.id}`, { method: 'DELETE' })
      cards.reload()
    })
  }

  return (
    <div className="c">
      <div className="hint-line" style={{ marginTop: 0 }}>
        A SEMS informa o número do cartão de cada recarga; com o cartão cadastrado aqui, a sessão cai sozinha na fatura do
        morador (inclusive as antigas). Com plug and charge, o número é o SN do carregador.
      </div>
      <form className="inline-form" onSubmit={add}>
        <input
          value={f.cardNumber}
          onChange={(e) => setF({ ...f, cardNumber: e.target.value })}
          placeholder="Número do cartão"
          required
        />
        <select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })} required aria-label="Morador">
          <option value="">Morador…</option>
          {/* convidado tem o cartão cadastrado no condomínio dele */}
          {users.data?.filter((u) => u.kind === 'MORADOR').map((u) => (
            <option key={u.id} value={u.id}>
              {u.unitLabel ? `${u.unitLabel} · ` : ''}
              {u.name}
            </option>
          ))}
        </select>
        <input value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Apelido (opcional)" />
        <button className="btn btn-primary btn-sm" disabled={act.busy}>
          Adicionar
        </button>
      </form>
      {act.error && <div className="login-error">{act.error}</div>}
      {cards.loading && !cards.data && <Loading />}
      {cards.data?.length === 0 && <Empty>Nenhum cartão cadastrado.</Empty>}
      {cards.data?.map((c) => (
        <div className="act wrap" key={c.id}>
          <div className="info">
            <div className="t">{c.cardNumber}</div>
            <div className="s">
              {c.userName}
              {c.label && ` · ${c.label}`}
            </div>
          </div>
          <span className={`ptag ${c.active ? 'cheap' : 'dim'}`}>{c.active ? 'Ativo' : 'Bloqueado'}</span>
          <button className="link-btn" onClick={() => toggle(c)} disabled={act.busy}>
            {c.active ? 'bloquear' : 'ativar'}
          </button>
          <button className="link-btn danger" onClick={() => remove(c)} disabled={act.busy}>
            remover
          </button>
        </div>
      ))}
    </div>
  )
}

/* ── pontos de recarga (mapa) ── */

type StationForm = {
  name: string
  address: string
  latitude: string
  longitude: string
  kind: StationKind
  openingHours: string
  price: string
  maxPowerKw: string
  imageUrl: string
  workspaceId: string
}

/** Síndico cadastra a estação do condomínio; parceiros e pontos públicos (da rede) são do superadmin. */
function StationModal({ station, onClose, onSaved }: { station: Station | null; onClose: () => void; onSaved: () => void }) {
  const { me } = useMe()
  const superAdmin = isSuperAdmin(me)
  const kinds = superAdmin ? (Object.keys(KIND_LABEL) as StationKind[]) : (['CONDOMINIO'] as StationKind[])
  // o superadmin escolhe de qual condomínio é a estação (ex.: um ponto da rede que virou condomínio)
  const condos = useApi<WorkspaceSummary[]>(superAdmin ? '/api/super/workspaces' : null)
  const [f, setF] = useState<StationForm>({
    name: station?.name ?? '',
    address: station?.address ?? '',
    latitude: station?.latitude?.toString() ?? '',
    longitude: station?.longitude?.toString() ?? '',
    kind: station?.kind ?? kinds[0]!,
    openingHours: station?.openingHours ?? '',
    price: fromCents(station?.publicPriceCentsKwh ?? null),
    maxPowerKw: station?.chargers[0]?.maxPowerKw ? String(Number(station.chargers[0].maxPowerKw)) : '7',
    imageUrl: station?.imageUrl ?? '',
    workspaceId: station?.workspace?.id ?? me.workspace?.id ?? '',
  })
  const { busy, error, run } = useAction()
  const set = (k: keyof StationForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value })

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const json = {
        name: f.name,
        address: f.address || null,
        latitude: toNum(f.latitude),
        longitude: toNum(f.longitude),
        kind: f.kind,
        openingHours: f.openingHours || null,
        publicPriceCentsKwh: f.kind === 'CONDOMINIO' ? null : toCents(f.price),
        maxPowerKw: toNum(f.maxPowerKw) ?? 7,
        imageUrl: f.imageUrl.trim() || null,
        ...(superAdmin && f.kind === 'CONDOMINIO' && f.workspaceId && { workspaceId: f.workspaceId }),
      }
      await api(station ? `/api/admin/stations/${station.id}` : '/api/admin/stations', {
        method: station ? 'PATCH' : 'POST',
        json,
      })
      onSaved()
    })
  }

  return (
    <Modal title={station ? 'Editar ponto de recarga' : 'Novo ponto de recarga'} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Nome">
          <input value={f.name} onChange={set('name')} required />
        </Field>
        <Field label="Endereço">
          <input value={f.address} onChange={set('address')} />
        </Field>
        <div className="form-2">
          <Field label="Latitude">
            <input value={f.latitude} onChange={set('latitude')} inputMode="decimal" placeholder="-23.5748" required />
          </Field>
          <Field label="Longitude">
            <input value={f.longitude} onChange={set('longitude')} inputMode="decimal" placeholder="-46.6322" required />
          </Field>
        </div>
        <MapPicker
          lat={f.latitude ? parseFloat(f.latitude) : null}
          lon={f.longitude ? parseFloat(f.longitude) : null}
          onSelect={(lat, lon) => {
            setF({ ...f, latitude: lat.toString(), longitude: lon.toString() })
          }}
        />
        <div className="form-2">
          <Field label="Tipo">
            <select value={f.kind} onChange={set('kind')} disabled={kinds.length === 1}>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Potência (kW)">
            <input value={f.maxPowerKw} onChange={set('maxPowerKw')} inputMode="decimal" required />
          </Field>
        </div>
        {superAdmin && f.kind === 'CONDOMINIO' && (
          <Field label="Condomínio">
            <select value={f.workspaceId} onChange={set('workspaceId')}>
              {condos.data
                ?.filter((w) => !w.archivedAt)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <div className="form-2">
          <Field label="Horário">
            <input value={f.openingHours} onChange={set('openingHours')} placeholder="todos os dias, 7h–22h" />
          </Field>
          {f.kind !== 'CONDOMINIO' && (
            <Field label="Preço (R$/kWh)" hint="informado pelo local">
              <input value={f.price} onChange={set('price')} inputMode="decimal" placeholder="0,89" />
            </Field>
          )}
        </div>
        <Field label="URL da foto" hint="opcional — URL (https://…) ou arquivo do app (/stations/…); sem uma, o app mostra um preview gerado">
          <input value={f.imageUrl} onChange={set('imageUrl')} placeholder="https://… ou /stations/…" />
        </Field>
        {error && <div className="login-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </Modal>
  )
}

function Estacoes() {
  const { me } = useMe()
  const superAdmin = isSuperAdmin(me)
  const stations = useApi<Station[]>('/api/stations')
  const [editing, setEditing] = useState<Station | 'new' | null>(null)
  const act = useAction()
  // as deste condomínio e as da rede; estação de outro condomínio é com o síndico de lá (o
  // superadmin vê e edita todas)
  const visible = stations.data?.filter((s) => superAdmin || !s.workspace || s.workspace.id === me.workspace?.id)
  const canEdit = (s: Station) => superAdmin || s.workspace?.id === me.workspace?.id

  const remove = (s: Station) => {
    if (!confirm(`Apagar ${s.name} do mapa?`)) return
    void act.run(async () => {
      await api(`/api/admin/stations/${s.id}`, { method: 'DELETE' })
      stations.reload()
    })
  }

  return (
    <div className="c">
      <div className="c-label row-between">
        Pontos no mapa
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          + Novo ponto
        </button>
      </div>
      {act.error && <div className="login-error">{act.error}</div>}
      {stations.loading && !stations.data && <Loading />}
      {visible?.map((s) => (
        <div className="act wrap" key={s.id}>
          <div className="info">
            <div className="t">{s.name}</div>
            <div className="s">
              {s.address ?? 'sem endereço'}
              {superAdmin && s.workspace && s.workspace.id !== me.workspace?.id && ` · ${s.workspace.name}`}
              {s.chargers.some((c) => c.externalId) && ' · recebe as sessões da SEMS'}
            </div>
          </div>
          <span className={`ptag ${s.kind === 'CONDOMINIO' ? 'mid' : 'dim'}`}>{KIND_LABEL[s.kind]}</span>
          {canEdit(s) && (
            <button className="link-btn" onClick={() => setEditing(s)}>
              editar
            </button>
          )}
          {canEdit(s) && !s.chargers.some((c) => c.externalId) && (
            <button className="link-btn danger" onClick={() => remove(s)} disabled={act.busy}>
              apagar
            </button>
          )}
        </div>
      ))}
      {editing && (
        <StationModal
          station={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            stations.reload()
          }}
        />
      )}
    </div>
  )
}

export default function Cadastros() {
  const [sub, setSub] = useState<Sub>('moradores')
  return (
    <>
      <div className="seg seg-wide">
        {SUBS.map((s) => (
          <button key={s.id} className={sub === s.id ? 'on' : ''} onClick={() => setSub(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      {sub === 'moradores' && <Moradores />}
      {sub === 'unidades' && <Unidades />}
      {sub === 'cartoes' && <Cartoes />}
      {sub === 'estacoes' && <Estacoes />}
    </>
  )
}
