import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ChargerMap from '../../components/ChargerMap'
import VoltChat from '../../components/VoltChat'
import { authClient } from '../../lib/authClient'
import { directionsUrl, type ChargePoint } from '../../lib/chargePoints'
import { api, setActiveWorkspace } from '../../lib/http'
import type { Me } from '../../lib/types'
import { useAction } from '../../lib/useAction'
import { useApi } from '../../lib/useApi'
import type { VoltActionName } from '../../lib/voltAgent'
import Agendar from './Agendar'
import Fatura from './Fatura'
import Gestor from './gestor/Gestor'
import { GESTOR_SECTIONS, type GestorSection } from './gestor/sections'
import Home from './Home'
import { I } from './icons'
import Login from './Login'
import Perfil from './Perfil'
import Sidebar from './Sidebar'
import { ErrorBox, Field, Modal } from './ui'
import { isStaff, isSuperAdmin, MeContext, useMe } from './me'

export type Tab = 'home' | 'agendar' | 'mapa' | 'fatura' | 'perfil'

const TABS: Tab[] = ['home', 'agendar', 'mapa', 'fatura', 'perfil']

/** URL de cada seção do gestor (a de "geral" é a raiz `/app/gestor`, pra não quebrar links já
 * salvos) ↔ seção. Cada uma vira um item próprio na sidebar, igual ao menu do morador. */
const GESTOR_URL: Record<GestorSection, string> = {
  geral: 'gestor', operacao: 'gestor-operacao', rateio: 'gestor-rateio', cobrancas: 'gestor-cobrancas', cadastros: 'gestor-cadastros',
  pedidos: 'gestor-pedidos', config: 'gestor-config', condominios: 'gestor-condominios',
}
const SECTION_BY_URL = new Map(Object.entries(GESTOR_URL).map(([section, url]) => [url, section as GestorSection]))

const GESTOR_ICON: Record<GestorSection, React.ReactNode> = {
  geral: I.chart, operacao: I.bolt, rateio: I.bill, cobrancas: I.wallet, cadastros: I.card, pedidos: I.user, config: I.gear,
  condominios: I.home2,
}

/** Pedido de acesso a um condomínio da rede: vai para o síndico de lá. */
function JoinModal({ point, onClose }: { point: ChargePoint; onClose: () => void }) {
  const { reloadMe } = useMe()
  const [message, setMessage] = useState('')
  const send = useAction()
  const submit = () =>
    void send.run(async () => {
      await api('/api/me/join-requests', { method: 'POST', json: { workspaceId: point.workspaceId, message: message || null } })
      reloadMe()
      onClose()
    })
  return (
    <Modal title={`Pedir acesso · ${point.name}`} onClose={onClose}>
      <p className="modal-text">
        O síndico do condomínio recebe seu pedido. Aprovado, você pode agendar recargas lá como convidado e paga só o
        que carregar.
      </p>
      <Field label="Mensagem para o síndico (opcional)">
        <textarea value={message} maxLength={300} rows={3} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      {send.error && <div className="login-error">{send.error}</div>}
      <button className="btn btn-primary" onClick={submit} disabled={send.busy}>
        {send.busy ? 'Enviando…' : 'Enviar pedido'}
      </button>
    </Modal>
  )
}

function Mapa({ go }: { go: (t: Tab) => void }) {
  const { me, switchWorkspace } = useMe()
  const [asking, setAsking] = useState<ChargePoint | null>(null)
  const active = me.workspace?.id
  const pending = new Set(me.joinRequests.filter((r) => r.status === 'PENDING').map((r) => r.workspaceId))

  const label = (p: ChargePoint) => {
    if (p.kind === 'seu') return !p.workspaceId || p.workspaceId === active ? 'Agendar recarga aqui' : 'Usar este condomínio'
    if (p.kind === 'condominio') return pending.has(p.workspaceId ?? '') ? 'Pedido aguardando o síndico' : 'Pedir acesso'
    return 'Como chegar'
  }
  const choose = (p: ChargePoint) => {
    if (p.kind === 'seu') return !p.workspaceId || p.workspaceId === active ? go('agendar') : switchWorkspace(p.workspaceId)
    if (p.kind === 'condominio') return pending.has(p.workspaceId ?? '') ? go('perfil') : setAsking(p)
    window.open(directionsUrl(p), '_blank', 'noopener')
  }

  return (
    <div className="screen-anim">
      <div className="screen-title">Onde carregar</div>
      <div className="screen-sub">
        O carregador do seu condomínio, outros condomínios da rede, os parceiros Chargefy e os pontos públicos por perto.
      </div>
      <ChargerMap
        height={340}
        // o superadmin entra em qualquer condomínio: todos aparecem como "seu"
        myWorkspaces={isSuperAdmin(me) ? undefined : me.memberships.map((m) => m.workspaceId)}
        activeWorkspaceId={active}
        chooseLabel={label}
        onChoose={choose}
      />
      {asking && <JoinModal point={asking} onClose={() => setAsking(null)} />}
    </div>
  )
}

/**
 * Shell do app logado: busca /api/me uma vez e entrega para as telas via MeContext. Trocar de
 * condomínio remonta o shell (key em App), e todas as telas buscam de novo no condomínio novo.
 */
function Shell({ onSwitchWorkspace }: { onSwitchWorkspace: (id: string) => void }) {
  const { tab: tabParam } = useParams<{ tab: string }>()
  const navigate = useNavigate()
  const me = useApi<Me>('/api/me')
  const [saindo, setSaindo] = useState(false)

  // o servidor resolve o condomínio padrão quando o app não escolheu: guarda para as próximas
  const activeWs = me.data?.workspace?.id ?? null
  useEffect(() => {
    if (me.data) setActiveWorkspace(activeWs)
  }, [me.data, activeWs])

  // Sai e volta para o início: quem entrar de novo não cai na última tela (ex.: painel do gestor).
  const logout = async () => {
    setSaindo(true)
    try {
      const { error } = await authClient.signOut()
      if (error) throw error
      navigate('/app/home', { replace: true })
    } catch {
      window.alert('Não foi possível sair agora. Verifique sua conexão e tente de novo.')
    } finally {
      setSaindo(false)
    }
  }

  const gestorSection = SECTION_BY_URL.get(tabParam ?? '')
  const gestor = gestorSection !== undefined
  const tab: Tab = gestor ? 'perfil' : TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'home'

  useEffect(() => {
    if (!gestor && !TABS.includes(tabParam as Tab)) navigate('/app/home', { replace: true })
  }, [gestor, tabParam, navigate])

  const go = (t: Tab) => navigate(`/app/${t}`)
  const openGestor = () => navigate('/app/gestor')
  const goGestor = (s: GestorSection) => navigate(`/app/${GESTOR_URL[s]}`)

  const handleVoltAction = (action: VoltActionName) => {
    switch (action) {
      case 'ir_para_inicio':
        return go('home')
      case 'ir_para_agendamento':
        return go('agendar')
      case 'ir_para_fatura':
        return go('fatura')
      case 'ir_para_painel_gestor':
        return me.data && isStaff(me.data) ? openGestor() : go('perfil')
    }
  }

  if (!me.data) {
    return (
      <div className="login">
        <div className="login-glow" />
        {me.error && (
          <div className="login-box">
            <ErrorBox error={me.error} onRetry={me.reload} />
          </div>
        )}
      </div>
    )
  }

  const staff = isStaff(me.data)
  const showGestor = gestor && staff

  return (
    <MeContext.Provider value={{ me: me.data, reloadMe: me.reload, switchWorkspace: onSwitchWorkspace }}>
      <div className="app-root">
        <Sidebar
          me={me.data}
          onLogout={logout}
          saindo={saindo}
          groups={[
            {
              id: 'morador',
              label: 'Morador',
              items: [
                { id: 'home', label: 'Início', icon: I.home, on: tab === 'home' && !gestor, onClick: () => go('home') },
                { id: 'agendar', label: 'Agendar recarga', icon: I.cal, on: tab === 'agendar', onClick: () => go('agendar') },
                { id: 'mapa', label: 'Onde carregar', icon: I.pin, on: tab === 'mapa', onClick: () => go('mapa') },
                { id: 'fatura', label: 'Minha fatura', icon: I.bill, on: tab === 'fatura', onClick: () => go('fatura') },
                { id: 'perfil', label: 'Perfil', icon: I.user, on: tab === 'perfil' && !gestor, onClick: () => go('perfil') },
              ],
            },
            ...(staff
              ? [
                  {
                    id: 'admin',
                    label: 'Administração',
                    items: GESTOR_SECTIONS.filter((sec) => !sec.superOnly || isSuperAdmin(me.data!)).map((sec) => ({
                      id: sec.id,
                      label: sec.label,
                      icon: GESTOR_ICON[sec.id],
                      on: gestorSection === sec.id,
                      onClick: () => goGestor(sec.id),
                    })),
                  },
                ]
              : []),
          ]}
        />

        <div className="phone-stage">
          <div className="ambient" />
          <div className="phone">
            <div className="phone-scroll" key={`${tab}-${gestor}`}>
              {tab === 'home' && <Home go={go} />}
              {tab === 'agendar' && <Agendar go={go} />}
              {tab === 'mapa' && <Mapa go={go} />}
              {tab === 'fatura' && <Fatura />}
              {tab === 'perfil' &&
                (showGestor ? (
                  <Gestor section={gestorSection ?? 'geral'} onSection={goGestor} back={() => go('perfil')} />
                ) : (
                  <Perfil openGestor={openGestor} openMapa={() => go('mapa')} onLogout={logout} saindo={saindo} />
                ))}
            </div>

            <VoltChat onAction={handleVoltAction} variant="app" />

            <nav className="bottom-nav">
              {(
                [
                  ['home', 'Início', I.home],
                  ['agendar', 'Agendar', I.cal],
                  ['mapa', 'Mapa', I.pin],
                  ['fatura', 'Fatura', I.bill],
                  ['perfil', 'Perfil', I.user],
                ] as [Tab, string, React.ReactNode][]
              ).map(([t, label, icon]) => (
                <button key={t} className={`bn-item ${tab === t ? 'on' : ''}`} onClick={() => go(t)}>
                  {icon}
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </MeContext.Provider>
  )
}

export default function App() {
  const { data: session, isPending } = authClient.useSession()
  const [wsVersion, setWsVersion] = useState(0)
  const switchWorkspace = (id: string) => {
    setActiveWorkspace(id)
    setWsVersion((v) => v + 1)
  }
  // Enquanto confere o cookie, mostra só o fundo: evita piscar a tela de login para quem já está logado.
  if (isPending) return <div className="login"><div className="login-glow" /></div>
  if (!session) return <Login />
  // key: trocar de usuário ou de condomínio remonta o shell e busca /api/me de novo
  return <Shell key={`${session.user.id}:${wsVersion}`} onSwitchWorkspace={switchWorkspace} />
}
