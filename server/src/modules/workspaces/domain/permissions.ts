/**
 * Quem pode fazer o quê dentro de um condomínio (workspace). Funções puras: sem banco, sem rede.
 *
 *   SUPER_ADMIN  cria condomínios e qualquer admin ou usuário, em qualquer condomínio.
 *   ADMIN        síndico ou subsíndico: gerencia os USER do próprio condomínio e decide os
 *                pedidos de acesso. Não cria nem mexe em outro admin.
 *   USER         morador ou convidado: só os próprios dados.
 *
 * O papel no condomínio é do vínculo (workspace_member), não da pessoa: a mesma conta pode ser
 * admin num prédio e convidada em outro.
 */

export type PlatformRole = 'SUPER_ADMIN' | 'USER'
export type MemberRole = 'ADMIN' | 'USER'
export type AdminTitle = 'SINDICO' | 'SUBSINDICO'
export type MemberKind = 'MORADOR' | 'CONVIDADO'

/** Quem age, no condomínio ativo. `memberRole` null: não é membro (só o superadmin chega assim). */
export type Actor = { userId: string; platformRole: PlatformRole; memberRole: MemberRole | null }

/** Vínculo de alguém no condomínio ativo. `memberships`: em quantos condomínios a conta está. */
export type Target = { userId: string; role: MemberRole; memberships: number }

export const isSuperAdmin = (a: Actor) => a.platformRole === 'SUPER_ADMIN'

/** Painel do gestor do condomínio. */
export const canAdminWorkspace = (a: Actor) => isSuperAdmin(a) || a.memberRole === 'ADMIN'

/** Dar este papel a alguém (cadastro ou troca): admin só cria usuário comum. */
export const canGrantRole = (a: Actor, role: MemberRole) => isSuperAdmin(a) || (a.memberRole === 'ADMIN' && role === 'USER')

/** Unidade, tipo e remoção do vínculo. O admin cuida dos USER; outro admin é com o superadmin. */
export const canManageMember = (a: Actor, t: Target) =>
  isSuperAdmin(a) || (a.memberRole === 'ADMIN' && t.role === 'USER' && t.userId !== a.userId)

/** Trocar o papel de alguém: nunca o próprio (ninguém se promove nem se rebaixa sozinho). */
export const canChangeRoleOf = (a: Actor, t: Target, to: MemberRole) =>
  t.userId !== a.userId && canManageMember(a, t) && canGrantRole(a, to)

/**
 * Nome e senha são da conta e valem em todos os condomínios dela. O admin só mexe na conta de
 * quem existe apenas no condomínio dele; um convidado que mora em outro prédio é com o admin de lá.
 */
export const canEditAccount = (a: Actor, t: Target) =>
  isSuperAdmin(a) || t.userId === a.userId || (canManageMember(a, t) && t.memberships === 1)

/** Admin precisa de cargo (síndico ou subsíndico); usuário comum não tem cargo. */
export function titleFor(role: MemberRole, title: AdminTitle | null | undefined): AdminTitle | null {
  if (role === 'USER') return null
  if (!title) throw new Error('Admin precisa ser síndico ou subsíndico')
  return title
}
