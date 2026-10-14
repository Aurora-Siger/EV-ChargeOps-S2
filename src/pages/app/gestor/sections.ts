export type GestorSection =
  | 'geral'
  | 'operacao'
  | 'rateio'
  | 'cobrancas'
  | 'cadastros'
  | 'pedidos'
  | 'config'
  | 'condominios'

/** `superOnly`: só o administrador da plataforma vê (não é do condomínio, é da rede). */
export const GESTOR_SECTIONS: { id: GestorSection; label: string; superOnly?: boolean }[] = [
  { id: 'geral', label: 'Visão geral' },
  { id: 'operacao', label: 'Operação' },
  { id: 'rateio', label: 'Custos & rateio' },
  { id: 'cobrancas', label: 'Cobranças' },
  { id: 'cadastros', label: 'Cadastros' },
  { id: 'pedidos', label: 'Pedidos de acesso' },
  { id: 'config', label: 'Configurações' },
  { id: 'condominios', label: 'Condomínios', superOnly: true },
]
