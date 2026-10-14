import { auth } from '../../infra/auth/auth.js'
import { AppError, ForbiddenError, NotFoundError } from '../../shared/errors.js'
import { stationsService } from '../stations/stations.service.js'
import { unitsService } from '../units/units.service.js'
import {
  canChangeRoleOf, canEditAccount, canGrantRole, canManageMember, isSuperAdmin, titleFor,
  type Actor, type AdminTitle, type MemberKind, type MemberRole, type Target,
} from '../workspaces/domain/permissions.js'
import { residentsRepository, type CardInput, type VehicleInput } from './residents.repository.js'

export type NewMember = {
  name: string
  email: string
  password: string
  role: MemberRole
  adminTitle?: AdminTitle | null
  unitId?: string | null
}
export type MemberUpdate = {
  name?: string
  role?: MemberRole
  adminTitle?: AdminTitle | null
  kind?: MemberKind
  unitId?: string | null
  password?: string
  cpfCnpj?: string
}

const TITLE_LABEL: Record<AdminTitle, string> = { SINDICO: 'síndico', SUBSINDICO: 'subsíndico' }

function titleOf(role: MemberRole, title: AdminTitle | null | undefined) {
  try {
    return titleFor(role, title)
  } catch (e) {
    throw new AppError((e as Error).message, 400, 'VALIDATION')
  }
}

/** Um síndico e um subsíndico por condomínio. */
async function checkTitleFree(workspaceId: string, title: AdminTitle | null, exceptUserId?: string) {
  if (!title) return
  const holder = await residentsRepository.titleHolder(workspaceId, title)
  if (holder && holder.userId !== exceptUserId) {
    throw new AppError(`Este condomínio já tem ${TITLE_LABEL[title]}`, 409, 'CONFLICT')
  }
}

/** Vínculo de alguém no condomínio, no formato das regras de permissão. */
async function targetIn(workspaceId: string, userId: string) {
  const member = await residentsRepository.findMember(workspaceId, userId)
  if (!member) throw new NotFoundError('Usuário')
  const target: Target = { userId, role: member.role, memberships: await residentsRepository.membershipsCount(userId) }
  return { member, target }
}

/** Morador deste condomínio (dono de cartão RFID). */
async function checkResident(workspaceId: string, userId: string) {
  const m = await residentsRepository.findMember(workspaceId, userId)
  if (!m || m.kind !== 'MORADOR') throw new NotFoundError('Morador')
}

/** CPF (11) ou CNPJ (14) com dígitos verificadores corretos. */
export function validDocument(digits: string): boolean {
  if (!/^\d+$/.test(digits) || new Set(digits).size === 1) return false
  const dv = (base: string, weights: number[]) => {
    const sum = weights.reduce((a, w, i) => a + w * Number(base[i]), 0) % 11
    return sum < 2 ? 0 : 11 - sum
  }
  if (digits.length === 11) {
    const d1 = dv(digits, [10, 9, 8, 7, 6, 5, 4, 3, 2])
    return d1 === Number(digits[9]) && dv(digits, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(digits[10])
  }
  if (digits.length === 14) {
    const d1 = dv(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
    return d1 === Number(digits[12]) && dv(digits, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) === Number(digits[13])
  }
  return false
}

export const residentsService = {
  async hasDocument(userId: string) {
    return (await residentsRepository.documentOf(userId)) !== null
  },

  async setDocument(userId: string, raw: string) {
    const digits = raw.replace(/\D/g, '')
    if (!validDocument(digits)) throw new AppError('CPF/CNPJ inválido', 400, 'VALIDATION')
    await residentsRepository.setDocument(userId, digits)
  },


  async listUsers(workspaceId: string) {
    const [users, cards, vehicles] = await Promise.all([
      residentsRepository.listMembers(workspaceId),
      residentsRepository.listCards({ workspaceId }),
      residentsRepository.listVehicles(),
    ])
    return users.map((u) => ({
      ...u,
      cards: cards.filter((c) => c.userId === u.id),
      vehicles: vehicles.filter((v) => v.userId === u.id).map(({ id, model, plate }) => ({ id, model, plate })),
    }))
  },

  /**
   * Cadastro no condomínio (não há cadastro público). Conta nova pelo adapter interno do Better
   * Auth, porque `disableSignUp` bloqueia o signUpEmail. E-mail que já tem conta: só o superadmin
   * vincula direto; os outros entram pelo pedido de acesso do mapa.
   */
  async createUser(actor: Actor, workspaceId: string, input: NewMember) {
    if (!canGrantRole(actor, input.role)) {
      throw new ForbiddenError(
        input.role === 'ADMIN' ? 'Síndico e subsíndico são cadastrados pelo administrador da plataforma' : 'Sem permissão',
      )
    }
    const adminTitle = titleOf(input.role, input.adminTitle)
    await Promise.all([unitsService.check(workspaceId, input.unitId), checkTitleFree(workspaceId, adminTitle)])

    const ctx = await auth.$context
    const email = input.email.trim().toLowerCase()
    const existing = await ctx.internalAdapter.findUserByEmail(email)
    let userId: string
    if (existing) {
      if (!isSuperAdmin(actor)) {
        throw new AppError('Já existe uma conta com este e-mail. A pessoa pode pedir acesso pelo mapa.', 409, 'CONFLICT')
      }
      if (await residentsRepository.findMember(workspaceId, existing.user.id)) {
        throw new AppError('Esta pessoa já participa deste condomínio', 409, 'CONFLICT')
      }
      userId = existing.user.id
    } else {
      const created = await ctx.internalAdapter.createUser(
        { email, name: input.name.trim(), emailVerified: true, role: 'USER' },
        { method: 'admin' },
      )
      await ctx.internalAdapter.linkAccount({
        userId: created.id,
        providerId: 'credential',
        accountId: created.id,
        password: await ctx.password.hash(input.password),
      })
      userId = created.id
    }
    await residentsRepository.insertMember({
      workspaceId,
      userId,
      role: input.role,
      adminTitle,
      kind: 'MORADOR',
      unitId: input.unitId ?? null,
    })
    return { id: userId }
  },

  async updateUser(actor: Actor, workspaceId: string, id: string, v: MemberUpdate) {
    const { member, target } = await targetIn(workspaceId, id)

    const role = v.role ?? member.role
    const adminTitle = role === 'USER' ? null : v.adminTitle !== undefined ? v.adminTitle : member.adminTitle
    const roleChange = role !== member.role || adminTitle !== member.adminTitle
    if (roleChange) {
      if (id === actor.userId) throw new AppError('Você não pode mudar o próprio papel', 400, 'VALIDATION')
      if (!canChangeRoleOf(actor, target, role)) throw new ForbiddenError()
      await checkTitleFree(workspaceId, titleOf(role, adminTitle), id)
    }

    const kind = v.kind ?? member.kind
    // convidado não tem unidade aqui: a casa dele é em outro condomínio
    const unitId = kind === 'CONVIDADO' ? null : v.unitId
    if (v.kind !== undefined || unitId !== undefined) {
      if (!canManageMember(actor, target) && id !== actor.userId) throw new ForbiddenError()
      await unitsService.check(workspaceId, unitId)
    }

    // CPF/CNPJ do pagador: o gestor informa pelo morador (o Asaas exige para cobrar), sem tocar na conta.
    if (v.cpfCnpj !== undefined && id !== actor.userId && !canManageMember(actor, target)) throw new ForbiddenError()

    if (v.name !== undefined || v.password) {
      if (!canEditAccount(actor, target)) {
        throw new ForbiddenError('Esta pessoa também participa de outro condomínio: nome e senha ficam com ela')
      }
    }

    const memberPatch = {
      ...(roleChange && { role, adminTitle }),
      ...(v.kind !== undefined && { kind }),
      ...(unitId !== undefined && { unitId }),
    }
    if (Object.keys(memberPatch).length) await residentsRepository.updateMember(workspaceId, id, memberPatch)
    if (v.name !== undefined) await residentsRepository.renameUser(id, v.name)
    if (v.cpfCnpj !== undefined) await residentsService.setDocument(id, v.cpfCnpj)
    if (v.password) {
      const ctx = await auth.$context
      await ctx.internalAdapter.updatePassword(id, await ctx.password.hash(v.password))
    }
  },

  /**
   * Tira a pessoa do condomínio. Se era o único condomínio dela, a conta é apagada junto (como
   * antes dos workspaces); quem participa de outro prédio continua com a conta lá.
   */
  async removeUser(actor: Actor, workspaceId: string, id: string) {
    if (id === actor.userId) throw new AppError('Você não pode se remover do condomínio', 400, 'VALIDATION')
    const { target } = await targetIn(workspaceId, id)
    if (!canManageMember(actor, target)) throw new ForbiddenError()
    await residentsRepository.removeMember(workspaceId, id)
    const account = await residentsRepository.findUser(id)
    if (account && account.role !== 'SUPER_ADMIN' && (await residentsRepository.membershipsCount(id)) === 0) {
      const ctx = await auth.$context
      await ctx.internalAdapter.deleteUser(id)
    }
  },

  home: (userId: string, workspaceId: string) => residentsRepository.homeOf(userId, workspaceId),

  /** Carregador "de casa" no condomínio: o da unidade; sem unidade (ou convidado), o do condomínio. */
  async homeChargerId(userId: string, workspaceId: string) {
    const home = await residentsRepository.homeOf(userId, workspaceId)
    return home?.chargerId ?? (await stationsService.homeChargerOf(workspaceId))
  },

  // ---------- cartões ----------
  listCards: (workspaceId: string) => residentsRepository.listCards({ workspaceId }),
  cardsOf: (userId: string) => residentsRepository.listCards({ userId }),
  async createCard(workspaceId: string, c: CardInput) {
    await checkResident(workspaceId, c.userId)
    return residentsRepository.createCard({ ...c, cardNumber: c.cardNumber.trim() })
  },
  async ownCard(workspaceId: string, id: string) {
    const card = await residentsRepository.findCard(id)
    if (!card) throw new NotFoundError('Cartão')
    await checkResident(workspaceId, card.userId).catch(() => {
      throw new NotFoundError('Cartão')
    })
    return card
  },
  async updateCard(workspaceId: string, id: string, c: Partial<CardInput>) {
    await residentsService.ownCard(workspaceId, id)
    if (c.userId) await checkResident(workspaceId, c.userId)
    const row = await residentsRepository.updateCard(id, c)
    if (!row) throw new NotFoundError('Cartão')
    return row
  },
  async removeCard(workspaceId: string, id: string) {
    await residentsService.ownCard(workspaceId, id)
    await residentsRepository.removeCard(id)
  },

  // ---------- veículos (sempre do próprio usuário) ----------
  listVehicles: (userId: string) => residentsRepository.listVehicles(userId),
  createVehicle: (userId: string, v: VehicleInput) => residentsRepository.createVehicle(userId, v),
  async ownVehicle(userId: string, id: string) {
    const v = await residentsRepository.findVehicle(id)
    if (!v) throw new NotFoundError('Veículo')
    if (v.userId !== userId) throw new ForbiddenError()
    return v
  },
  async updateVehicle(userId: string, id: string, v: Partial<VehicleInput>) {
    await residentsService.ownVehicle(userId, id)
    return residentsRepository.updateVehicle(id, v)
  },
  async removeVehicle(userId: string, id: string) {
    await residentsService.ownVehicle(userId, id)
    await residentsRepository.removeVehicle(id)
  },
}
