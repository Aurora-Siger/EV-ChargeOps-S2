import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import logo from '../../assets/logo.png'
import type { Me, WorkspaceSummary } from '../../lib/types'
import { useApi } from '../../lib/useApi'
import { I } from './icons'
import { initials, isSuperAdmin, memberLabel, useMe } from './me'

/** Preferência só deste navegador: se o localStorage falhar (aba anônima), vale o padrão. */
function usePersisted(key: string, initial: boolean) {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(key)
      return v === null ? initial : v === '1'
    } catch {
      return initial
    }
  })
  const set = (v: boolean) => {
    setValue(v)
    try {
      localStorage.setItem(key, v ? '1' : '0')
    } catch {
      /* sem storage: fica só na memória */
    }
  }
  return [value, set] as const
}

export type SideEntry = { id: string; label: string; icon: ReactNode; on: boolean; onClick: () => void }

function Group({ id, label, items, railMode }: { id: string; label: string; items: SideEntry[]; railMode: boolean }) {
  const [open, setOpen] = usePersisted(`chargefy.side.${id}`, true)
  // No modo trilho (só ícones) os grupos ficam sempre abertos: o rótulo nem aparece.
  const expanded = railMode || open
  return (
    <div className={`side-group ${expanded ? 'open' : ''}`}>
      <button
        className="side-label"
        onClick={() => setOpen(!open)}
        aria-expanded={expanded}
        tabIndex={railMode ? -1 : 0}
      >
        <span>{label}</span>
        <span className="side-label-chev">{I.chevD}</span>
      </button>
      <div className="side-group-body">
        <div className="side-group-inner">
          {items.map((it, i) => (
            <button
              key={it.id}
              className={`side-item ${it.on ? 'on' : ''}`}
              onClick={it.onClick}
              title={railMode ? it.label : undefined}
              aria-current={it.on ? 'page' : undefined}
              style={{ '--i': i } as React.CSSProperties}
            >
              <span className="side-icon">{it.icon}</span>
              <span className="side-text">{it.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Condomínio ativo. Aparece para quem participa de mais de um (morador aqui, convidado ali) e
 * para o superadmin, que escolhe entre todos. Trocar recarrega o app inteiro no condomínio novo.
 */
function WorkspaceSwitcher() {
  const { me, switchWorkspace } = useMe()
  const superAdmin = isSuperAdmin(me)
  const all = useApi<WorkspaceSummary[]>(superAdmin ? '/api/super/workspaces' : null)
  const options = superAdmin
    ? (all.data ?? []).map((w) => ({ id: w.id, label: w.archivedAt ? `${w.name} (arquivado)` : w.name }))
    : me.memberships.map((m) => ({ id: m.workspaceId, label: `${m.name} · ${memberLabel(m).toLowerCase()}` }))
  if (options.length < 2 && !superAdmin) return null
  return (
    <label className="side-ws">
      <span>Condomínio</span>
      <select value={me.workspace?.id ?? ''} onChange={(e) => switchWorkspace(e.target.value)}>
        {!me.workspace && <option value="">— nenhum —</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * Menu lateral do app no desktop. Colapsa para um trilho só de ícones (a preferência fica no
 * navegador), cada grupo abre e fecha sozinho, e a lista rola por conta própria com o rodapé
 * (usuário e sair) sempre visível — em telas baixas nada fica escondido.
 */
export default function Sidebar({
  me,
  groups,
  onLogout,
  saindo,
}: {
  me: Me
  groups: { id: string; label: string; items: SideEntry[] }[]
  onLogout: () => void
  saindo: boolean
}) {
  const [collapsed, setCollapsed] = usePersisted('chargefy.side.collapsed', false)

  return (
    <aside className={`app-side ${collapsed ? 'collapsed' : ''}`}>
      <div className="side-head">
        <Link to="/" className="side-logo" title="Voltar para o site">
          <img src={logo} alt="Chargefy" />
        </Link>
        <button
          className="side-toggle"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        >
          {I.panel}
        </button>
      </div>

      <WorkspaceSwitcher />

      <nav className="side-nav">
        {groups.map((g) => (
          <Group key={g.id} id={g.id} label={g.label} items={g.items} railMode={collapsed} />
        ))}
      </nav>

      <div className="side-foot">
        {me.unit && (
          <span className="side-status" title={me.unit.label}>
            <span className="dot" /> <span className="side-text">{me.unit.label}</span>
          </span>
        )}
        <div className="side-user" title={collapsed ? `${me.user.name} · ${me.user.email}` : undefined}>
          <div className="side-avatar">{initials(me.user.name)}</div>
          <div className="side-user-info side-text">
            <div className="n">{me.user.name}</div>
            <div className="e">{me.user.email}</div>
          </div>
        </div>
        <button className="side-logout" onClick={onLogout} disabled={saindo} title={collapsed ? 'Sair da conta' : undefined}>
          <span className="side-icon">{I.logout}</span>
          <span className="side-text">{saindo ? 'Saindo…' : 'Sair da conta'}</span>
        </button>
      </div>
    </aside>
  )
}
