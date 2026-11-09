import { t } from '../../../lib/i18n'
export type GestorSection =
  | 'geral'
  | 'operacao'
  | 'agenda'
  | 'rateio'
  | 'cobrancas'
  | 'cadastros'
  | 'pedidos'
  | 'config'
  | 'condominios'

/** `superOnly`: só o administrador da plataforma vê (não é do condomínio, é da rede). */
const S: { id: GestorSection; label: readonly [string, string]; superOnly?: boolean }[] = [
  { id: 'geral', label: ['Visão geral', 'Overview'] },
  { id: 'operacao', label: ['Operação', 'Operations'] },
  { id: 'agenda', label: ['Agenda', 'Schedule'] },
  { id: 'rateio', label: ['Custos & rateio', 'Costs & split'] },
  { id: 'cobrancas', label: ['Cobranças', 'Billing'] },
  { id: 'cadastros', label: ['Cadastros', 'Records'] },
  { id: 'pedidos', label: ['Pedidos de acesso', 'Access requests'] },
  { id: 'config', label: ['Configurações', 'Settings'] },
  { id: 'condominios', label: ['Condomínios', 'Buildings'], superOnly: true },
]

/** Lido na hora (o rótulo segue o idioma escolhido). */
export const GESTOR_SECTIONS: { id: GestorSection; label: string; superOnly?: boolean }[] = new Proxy([] as never[], {
  get(_, key) {
    const arr = S.map((s) => ({ ...s, label: t(s.label[0], s.label[1]) }))
    const v = Reflect.get(arr, key)
    return typeof v === 'function' ? v.bind(arr) : v
  },
})
