import { createContext, useContext } from 'react'
import type { AdminTitle, MemberKind, MemberRole, Me } from '../../lib/types'

/* Usuário logado (/api/me), buscado uma vez pelo shell e compartilhado pelas telas. */

export const MeContext = createContext<{
  me: Me
  reloadMe: () => void
  /** Troca o condomínio ativo e recarrega o app inteiro nele. */
  switchWorkspace: (id: string) => void
} | null>(null)

export function useMe() {
  const ctx = useContext(MeContext)
  if (!ctx) throw new Error('useMe fora do MeContext')
  return ctx
}

export const isSuperAdmin = (me: Me) => me.user.role === 'SUPER_ADMIN'

/** Painel do gestor do condomínio ativo: superadmin ou síndico/subsíndico dele. */
export const isStaff = (me: Me) => isSuperAdmin(me) || me.workspace?.memberRole === 'ADMIN'

export const TITLE_LABEL: Record<AdminTitle, string> = { SINDICO: 'Síndico', SUBSINDICO: 'Subsíndico' }

/** "Síndico", "Morador", "Convidado"... papel de alguém num condomínio. */
export function memberLabel(m: { role: MemberRole; adminTitle: AdminTitle | null; kind: MemberKind | null }) {
  if (m.role === 'ADMIN') return m.adminTitle ? TITLE_LABEL[m.adminTitle] : 'Admin'
  return m.kind === 'CONVIDADO' ? 'Convidado' : 'Morador'
}

/** Papel de quem está logado no condomínio ativo. */
export function myRoleLabel(me: Me) {
  const ws = me.workspace
  if (ws?.memberRole) return memberLabel({ role: ws.memberRole, adminTitle: ws.adminTitle, kind: ws.kind })
  return isSuperAdmin(me) ? 'Superadmin' : 'Sem condomínio'
}

/** "Maria da Silva" → "MS" · "Administrador" → "AD" */
export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}
