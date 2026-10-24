import { useEffect, useRef, useState } from 'react'
import { currentPeriod } from '../../../lib/format'
import { I } from '../icons'
import { PeriodPicker } from '../ui'
import { isSuperAdmin, myRoleLabel, useMe } from '../me'
import Agenda from './Agenda'
import Cadastros from './Cadastros'
import Cobrancas from './Cobrancas'
import Condominios from './Condominios'
import Config from './Config'
import Geral from './Geral'
import Operacao from './Operacao'
import Pedidos from './Pedidos'
import Rateio from './Rateio'
import { GESTOR_SECTIONS, type GestorSection } from './sections'

/**
 * As seções vivem na sidebar no desktop (mesmo padrão do menu do morador) e numa faixa de
 * abas aqui dentro no mobile, onde não há sidebar — as duas controlam a mesma seção via URL
 * (`section`/`onSection`, geridos pelo Shell em App.tsx).
 */
export default function Gestor({ section: requested, onSection, back }: { section: GestorSection; onSection: (s: GestorSection) => void; back: () => void }) {
  const { me } = useMe()
  const now = currentPeriod()
  const [period, setPeriod] = useState(now)
  const superAdmin = isSuperAdmin(me)
  const sections = GESTOR_SECTIONS.filter((t) => !t.superOnly || superAdmin)
  // superadmin sem nenhum condomínio ainda: só a tela de criar um
  const section: GestorSection = !me.workspace
    ? 'condominios'
    : sections.some((t) => t.id === requested)
      ? requested
      : 'geral'
  const periodTabs = section === 'geral' || section === 'operacao' || section === 'rateio' || section === 'cobrancas'
  // No celular a faixa de abas rola pro lado: traz a aba ativa pra dentro da tela.
  const activeTab = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    // (scrollLeft direto: scrollIntoView também rolaria os contêineres de fora e deslocaria a tela)
    const tab = activeTab.current
    const strip = tab?.parentElement
    if (!tab || !strip) return
    strip.scrollTo({ left: tab.offsetLeft - strip.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' })
  }, [section])

  return (
    <div className="screen-anim">
      <button className="back-btn hide-desk" onClick={back}>
        {I.back} Voltar ao perfil
      </button>
      <div className="screen-title">Painel do gestor</div>
      <div className="screen-sub">
        {me.workspace?.name ?? 'Nenhum condomínio aberto'} · {myRoleLabel(me).toLowerCase()}
        {me.workspace?.archived && ' · arquivado'}
      </div>

      <div className="gestor-tabs">
        {sections.map((t) => (
          <button
            key={t.id}
            ref={section === t.id ? activeTab : undefined}
            className={`gestor-tab ${section === t.id ? 'on' : ''}`}
            onClick={() => onSection(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {periodTabs && <PeriodPicker period={period} onChange={setPeriod} max={now} />}

      {section === 'geral' && <Geral period={period} />}
      {section === 'operacao' && <Operacao period={period} />}
      {section === 'agenda' && <Agenda />}
      {section === 'rateio' && <Rateio period={period} canWrite goCobrancas={() => onSection('cobrancas')} />}
      {section === 'cobrancas' && <Cobrancas period={period} canWrite goRateio={() => onSection('rateio')} />}
      {section === 'cadastros' && <Cadastros />}
      {section === 'pedidos' && <Pedidos />}
      {section === 'config' && <Config canWrite />}
      {section === 'condominios' && superAdmin && <Condominios />}
    </div>
  )
}
