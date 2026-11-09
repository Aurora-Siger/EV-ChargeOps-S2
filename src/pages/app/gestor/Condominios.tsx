import { useState } from 'react'
import { api } from '../../../lib/http'
import type { WorkspaceSummary } from '../../../lib/types'
import { useAction } from '../../../lib/useAction'
import { useApi } from '../../../lib/useApi'
import { TITLE_LABEL, useMe } from '../me'
import { Empty, ErrorBox, Field, Loading, Modal } from '../ui'
import { t } from '../../../lib/i18n'

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
    <Modal title={ws ? t('Editar condomínio', 'Edit building') : t('Novo condomínio', 'New building')} onClose={onClose}>
      <form onSubmit={save}>
        <Field label={t('Nome', 'Name')}>
          <input value={f.name} onChange={set('name')} required placeholder="Residencial Bosque" />
        </Field>
        <Field label={t('Endereço', 'Address')}>
          <input value={f.address} onChange={set('address')} placeholder="Rua das Árvores, 10" />
        </Field>
        {!ws && (
          <>
            <div className="c-label" style={{ marginTop: 6 }}>
              {t('Síndico (opcional)', 'Building manager (optional)')}
            </div>
            <Field label={t('Nome do síndico', 'Building manager name')}>
              <input value={f.sindicoName} onChange={set('sindicoName')} required={!!withSindico} />
            </Field>
            <div className="form-2">
              <Field label={t('E-mail', 'Email')}>
                <input type="email" value={f.sindicoEmail} onChange={set('sindicoEmail')} required={!!withSindico} />
              </Field>
              <Field label={t('Senha inicial', 'Initial password')} hint={t('mínimo 8 caracteres', 'at least 8 characters')}>
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
          {busy ? t('Salvando…', 'Saving…') : t('Salvar', 'Save')}
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
      ? t(`Arquivar ${w.name}? Ele some do mapa e ninguém de lá consegue usar o app nele. Nada é apagado e dá para reativar.`, `Archive ${w.name}? It disappears from the map and nobody there can use the app. Nothing is deleted and you can reactivate it.`)
      : t(`Reativar ${w.name}?`, `Reactivate ${w.name}?`)
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
        {list.data?.length ?? 0} {t('condomínios', 'buildings')}
        <button className="btn btn-primary btn-sm" onClick={() => setEditing('new')}>
          + {t('Novo condomínio', 'New building')}
        </button>
      </div>
      {act.error && <div className="login-error">{act.error}</div>}
      {list.data?.length === 0 && <Empty>{t('Nenhum condomínio ainda.', 'No buildings yet.')}</Empty>}
      {list.data?.map((w) => {
        const active = w.id === me.workspace?.id
        const admins = w.admins.map((a) => `${a.title ? TITLE_LABEL[a.title] : 'Admin'}: ${a.name}`).join(' · ')
        return (
          <div className="act wrap" key={w.id}>
            <div className="info">
              <div className="t">
                {w.name} {active && <small>({t('aberto', 'open')})</small>}
              </div>
              <div className="s">
                {w.address ?? t('sem endereço', 'no address')} · {w.residents} {w.residents === 1 ? t('morador', 'resident') : t('moradores', 'residents')}
                {w.guests > 0 && ` · ${w.guests} ${w.guests === 1 ? t('convidado', 'guest') : t('convidados', 'guests')}`}
                {w.pendingRequests > 0 && ` · ${w.pendingRequests} ${t('pedido(s) aguardando', 'request(s) waiting')}`}
              </div>
              <div className="s">{admins || t('sem síndico cadastrado', 'no building manager registered')}</div>
            </div>
            {w.archivedAt && <span className="ptag dim">{t('Arquivado', 'Archived')}</span>}
            {!active && (
              <button className="btn btn-ghost btn-sm" onClick={() => switchWorkspace(w.id)}>
                {t('Abrir painel', 'Open dashboard')}
              </button>
            )}
            <button className="link-btn" onClick={() => setEditing(w)}>
              {t('editar', 'edit')}
            </button>
            <button className="link-btn danger" onClick={() => setArchived(w, !w.archivedAt)} disabled={act.busy}>
              {w.archivedAt ? t('reativar', 'reactivate') : t('arquivar', 'archive')}
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
