import { useState } from 'react'
import { api } from '../../../lib/http'
import type { WorkspaceSummary } from '../../../lib/types'
import { useAction } from '../../../lib/useAction'
import { useApi } from '../../../lib/useApi'
import { TITLE_LABEL, useMe } from '../me'
import { Empty, ErrorBox, Field, Loading, Modal } from '../ui'

type Form = { name: string; address: string; sindicoName: string; sindicoEmail: string; sindicoPassword: string }
const EMPTY: Form = { name: '', address: '', sindicoName: '', sindicoEmail: '', sindicoPassword: '' }

/** Criar ou editar um condomínio. Na criação, o síndico pode vir junto (ou ser cadastrado depois em Cadastros). */
function WorkspaceModal({ ws, onClose, onSaved }: { ws: WorkspaceSummary | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(ws ? { ...EMPTY, name: ws.name, address: ws.address ?? '' } : EMPTY)
  const { busy, error, run } = useAction()
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const withSindico = !ws && (f.sindicoName || f.sindicoEmail || f.sindicoPassword)

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    void run(async () => {
      const base = { name: f.name, address: f.address || null }
      if (ws) {
        await api(`/api/super/workspaces/${ws.id}`, { method: 'PATCH', json: base })
      } else {
        await api('/api/super/workspaces', {
          method: 'POST',
          json: {
            ...base,
            sindico: withSindico ? { name: f.sindicoName, email: f.sindicoEmail, password: f.sindicoPassword } : null,
          },
        })
      }
      onSaved()
    })
  }

  return (
    <Modal title={ws ? 'Editar condomínio' : 'Novo condomínio'} onClose={onClose}>
      <form onSubmit={save}>
        <Field label="Nome">
          <input value={f.name} onChange={set('name')} required placeholder="Residencial Bosque" />
        </Field>
        <Field label="Endereço">
          <input value={f.address} onChange={set('address')} placeholder="Rua das Árvores, 10" />
        </Field>
        {!ws && (
          <>
            <div className="c-label" style={{ marginTop: 6 }}>
              Síndico (opcional)
            </div>
            <Field label="Nome do síndico">
              <input value={f.sindicoName} onChange={set('sindicoName')} required={!!withSindico} />
            </Field>
            <div className="form-2">
              <Field label="E-mail">
                <input type="email" value={f.sindicoEmail} onChange={set('sindicoEmail')} required={!!withSindico} />
              </Field>
              <Field label="Senha inicial" hint="mínimo 8 caracteres">
                <input
                  value={f.sindicoPassword}
                  onChange={set('sindicoPassword')}
                  minLength={8}
                  required={!!withSindico}
                  autoComplete="new-password"
                />
              </Field>
            </div>
          </>
        )}
        {error && <div className="login-error">{error}</div>}
        <button className="btn btn-primary" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </Modal>
  )
}

/**
 * Tela do superadmin: os condomínios da plataforma. Criar, editar, arquivar (nada é apagado) e
 * abrir o painel de um deles. Pessoas, síndico e subsíndico de cada um ficam em Cadastros, com
 * ele aberto.
 */
export default function Condominios() {
  const { me, switchWorkspace } = useMe()
  const list = useApi<WorkspaceSummary[]>('/api/super/workspaces')
  const [editing, setEditing] = useState<WorkspaceSummary | 'new' | null>(null)
  const act = useAction()

  const setArchived = (w: WorkspaceSummary, archived: boolean) => {
    const msg = archived
      ? `Arquivar ${w.name}? Ele some do mapa e ninguém de lá consegue usar o app nele. Nada é apagado e dá para reativar.`
      : `Reativar ${w.name}?`
    if (!confirm(msg)) return
    void act.run(async () => {
      await api(`/api/super/workspaces/${w.id}`, { method: 'PATCH', json: { archived } })
      list.reload()
    })
  }

  if (list.loading && !list.data) return <Loading />
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />

  return (
    <div className="c">
      <div className="c-label row-between">
        {list.data?.length ?? 0} condomínios
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          + Novo condomínio
        </button>
      </div>
      {act.error && <div className="login-error">{act.error}</div>}
      {list.data?.length === 0 && <Empty>Nenhum condomínio ainda.</Empty>}
      {list.data?.map((w) => {
        const active = w.id === me.workspace?.id
        const admins = w.admins.map((a) => `${a.title ? TITLE_LABEL[a.title] : 'Admin'}: ${a.name}`).join(' · ')
        return (
          <div className="act wrap" key={w.id}>
            <div className="info">
              <div className="t">
                {w.name} {active && <small>(aberto)</small>}
              </div>
              <div className="s">
                {w.address ?? 'sem endereço'} · {w.residents} {w.residents === 1 ? 'morador' : 'moradores'}
                {w.guests > 0 && ` · ${w.guests} ${w.guests === 1 ? 'convidado' : 'convidados'}`}
                {w.pendingRequests > 0 && ` · ${w.pendingRequests} pedido(s) aguardando`}
              </div>
              <div className="s">{admins || 'sem síndico cadastrado'}</div>
            </div>
            {w.archivedAt && <span className="ptag dim">Arquivado</span>}
            {!active && (
              <button className="btn btn-ghost btn-sm" onClick={() => switchWorkspace(w.id)}>
                Abrir painel
              </button>
            )}
            <button className="link-btn" onClick={() => setEditing(w)}>
              editar
            </button>
            <button className="link-btn danger" onClick={() => setArchived(w, !w.archivedAt)} disabled={act.busy}>
              {w.archivedAt ? 'reativar' : 'arquivar'}
            </button>
          </div>
        )
      })}
      {editing && (
        <WorkspaceModal
          ws={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            list.reload()
          }}
        />
      )}
    </div>
  )
}
