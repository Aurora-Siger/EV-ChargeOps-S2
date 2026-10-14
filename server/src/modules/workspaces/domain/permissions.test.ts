import { describe, expect, it } from 'vitest'
import {
  canAdminWorkspace, canChangeRoleOf, canEditAccount, canGrantRole, canManageMember, titleFor, type Actor, type Target,
} from './permissions.js'

const superAdmin: Actor = { userId: 'su', platformRole: 'SUPER_ADMIN', memberRole: null }
const sindico: Actor = { userId: 'sin', platformRole: 'USER', memberRole: 'ADMIN' }
const morador: Actor = { userId: 'mor', platformRole: 'USER', memberRole: 'USER' }

const user = (memberships = 1): Target => ({ userId: 'u1', role: 'USER', memberships })
const subsindico: Target = { userId: 'sub', role: 'ADMIN', memberships: 1 }
const self = (a: Actor, role = a.memberRole ?? 'USER'): Target => ({ userId: a.userId, role, memberships: 1 })

describe('painel do condomínio', () => {
  it('superadmin e admin entram; usuário comum não', () => {
    expect(canAdminWorkspace(superAdmin)).toBe(true)
    expect(canAdminWorkspace(sindico)).toBe(true)
    expect(canAdminWorkspace(morador)).toBe(false)
  })
})

describe('quem cria quem', () => {
  it('superadmin cria admin e usuário', () => {
    expect(canGrantRole(superAdmin, 'ADMIN')).toBe(true)
    expect(canGrantRole(superAdmin, 'USER')).toBe(true)
  })
  it('admin cria só usuário comum', () => {
    expect(canGrantRole(sindico, 'USER')).toBe(true)
    expect(canGrantRole(sindico, 'ADMIN')).toBe(false)
  })
  it('usuário comum não cria ninguém', () => {
    expect(canGrantRole(morador, 'USER')).toBe(false)
  })
})

describe('gerenciar vínculos', () => {
  it('admin gerencia usuário comum, mas não outro admin nem a si mesmo', () => {
    expect(canManageMember(sindico, user())).toBe(true)
    expect(canManageMember(sindico, subsindico)).toBe(false)
    expect(canManageMember(sindico, self(sindico))).toBe(false)
  })
  it('superadmin gerencia qualquer um', () => {
    expect(canManageMember(superAdmin, subsindico)).toBe(true)
  })
  it('admin não promove ninguém a admin; superadmin promove', () => {
    expect(canChangeRoleOf(sindico, user(), 'ADMIN')).toBe(false)
    expect(canChangeRoleOf(superAdmin, user(), 'ADMIN')).toBe(true)
    expect(canChangeRoleOf(superAdmin, subsindico, 'USER')).toBe(true)
  })
  it('ninguém troca o próprio papel', () => {
    expect(canChangeRoleOf(sindico, self(sindico), 'USER')).toBe(false)
  })
})

describe('conta (nome e senha)', () => {
  it('admin edita a conta de quem só existe no condomínio dele', () => {
    expect(canEditAccount(sindico, user(1))).toBe(true)
  })
  it('admin não edita a conta de quem também está em outro condomínio', () => {
    expect(canEditAccount(sindico, user(2))).toBe(false)
  })
  it('cada um edita a própria conta; superadmin edita qualquer uma', () => {
    expect(canEditAccount(sindico, self(sindico))).toBe(true)
    expect(canEditAccount(superAdmin, user(3))).toBe(true)
  })
})

describe('cargo do admin', () => {
  it('admin precisa de cargo; usuário comum fica sem', () => {
    expect(titleFor('ADMIN', 'SUBSINDICO')).toBe('SUBSINDICO')
    expect(titleFor('USER', 'SINDICO')).toBeNull()
    expect(() => titleFor('ADMIN', null)).toThrow()
  })
})
