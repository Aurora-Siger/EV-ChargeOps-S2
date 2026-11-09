import { t } from '../lib/i18n'
import LangToggle from '../components/LangToggle'
import { type MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from 'react'
import { TrendingUp, CalendarClock, MessagesSquare } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import Reveal from '../components/Reveal'
import Volt from '../components/Volt'
import VoltChat from '../components/VoltChat'
import ChargerMap from '../components/ChargerMap'
import logo from '../assets/logo.png'
import hcaG2 from '../assets/hca-g2.png'
import goodweLogo from '../assets/goodwe-logo.svg'
import '@google/model-viewer'

/** Logo da FIAP: salve em src/assets/fiap-logo.(svg|png|webp) que ela substitui o wordmark */
const FIAP_LOGO = Object.values(
  import.meta.glob('../assets/fiap-logo.{svg,png,webp}', { eager: true, import: 'default' }) as Record<string, string>,
)[0]


/**
 * Fotos da equipe: basta salvar o arquivo em src/assets/team/<slug>.jpg|png|webp
 * (ex.: src/assets/team/matheus.jpg) que ele aparece no card automaticamente.
 * Sem arquivo, o card cai nas iniciais.
 */
const TEAM_PHOTOS = import.meta.glob('../assets/team/*.{jpg,jpeg,png,webp}', {
  eager: true,
  import: 'default',
}) as Record<string, string>

function photoOf(slug: string) {
  const hit = Object.entries(TEAM_PHOTOS).find(([path]) => path.includes(`/${slug}.`))
  return hit?.[1]
}

const TEAM = [
  {
    name: 'Isabelle Caroline de Camargo',
    rm: '572096',
    initials: 'IC',
    slug: 'isabelle',
    linkedin: 'https://www.linkedin.com/in/isabelle-caroline-989506342/',
  },
  {
    name: 'Matheus Lyncoln Souza Dias',
    rm: '570765',
    initials: 'ML',
    slug: 'matheus',
    linkedin: 'https://www.linkedin.com/in/matheus-lyncoln-dias-7898351b5/',
  },
  {
    name: 'Mirela Aparecida Bispo Miguel',
    rm: '570830',
    initials: 'MB',
    slug: 'mirela',
    linkedin: 'https://www.linkedin.com/in/mirela-miguel-8a46182a3/',
  },
  {
    name: 'Rodrigo Abrantes Mizerani',
    rm: '571808',
    initials: 'RM',
    slug: 'rodrigo',
    linkedin: 'https://www.linkedin.com/in/rodrigo-abrantes-261545199/',
  },
]

const NAV_ITEMS = [
  { label: 'Benefícios', en: 'Benefits', sectionId: 'beneficios' },
  { label: 'Como funciona', en: 'How it works', sectionId: 'como-funciona' },
  { label: 'Conheça o Volt', en: 'Meet Volt', sectionId: 'volt' },
  { label: 'Motor de IA', en: 'AI engine', sectionId: 'ia' },
  { label: 'Rateio justo', en: 'Fair split', sectionId: 'rateio' },
  { label: 'Hardware', en: 'Hardware', sectionId: 'hardware' },
  { label: 'Rede', en: 'Network', sectionId: 'rede' },
  { label: 'Para o condomínio', en: 'For buildings', sectionId: 'condominio' },
  { label: 'Equipe', en: 'Team', sectionId: 'equipe' },
]

function scrollToLandingSection(sectionId?: string) {
  if (!sectionId) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }

  const element = document.getElementById(sectionId)
  if (!element) return

  const navOffset = 82
  const top = element.getBoundingClientRect().top + window.scrollY - navOffset
  window.scrollTo({ top, behavior: 'smooth' })
}

function handleSectionLink(event: ReactMouseEvent<HTMLAnchorElement>, sectionId?: string) {
  event.preventDefault()
  scrollToLandingSection(sectionId)
}

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <nav className={`nav ${scrolled ? 'scrolled' : ''}`}>
      <div className="nav-inner">
        <a href="#top" className="nav-logo" onClick={(event) => handleSectionLink(event)}>
          <img src={logo} alt="Chargefy" />
        </a>
        <div className="nav-links">
          {NAV_ITEMS.map((item) => (
            <a href={`#${item.sectionId}`} key={item.sectionId} onClick={(event) => handleSectionLink(event, item.sectionId)}>
              {t(item.label, item.en)}
            </a>
          ))}
        </div>
        <LangToggle />
        <Link to="/app" className="btn btn-primary btn-sm">
          {t('Entrar', 'Sign in')} </Link>
      </div>
    </nav>
  )
}

/** Raio decorativo do hero — mesmo traço do logo, em ângulos diferentes */
function HeroBolt({
  size,
  rotate,
  delay,
  style,
  tone = 'pink',
  className = '',
}: {
  size: number
  rotate: number
  delay: string
  style: React.CSSProperties
  tone?: 'pink' | 'amber'
  className?: string
}) {
  return (
    <svg
      className={`hero-bolt ${tone} ${className}`}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      style={{ ...style, animationDelay: delay, '--rot': `${rotate}deg` } as React.CSSProperties}
    >
      <path d="M17.8 4 8 18h6.2L12.6 28 22.8 13h-6.4L17.8 4Z" />
    </svg>
  )
}

/** Celular flutuante com tilt 3D que mostra a Home do app */
function PhoneHero() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const stage = ref.current
    if (!stage) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const phone = stage.querySelector<HTMLElement>('.iphone')
    if (!phone) return
    const onMove = (e: globalThis.MouseEvent) => {
      const r = stage.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width - 0.5
      const y = (e.clientY - r.top) / r.height - 0.5
      phone.style.animation = 'none'
      phone.style.transform = `rotateX(${4 - y * 10}deg) rotateY(${-8 + x * 14}deg)`
    }
    const onLeave = () => {
      phone.style.transform = ''
      phone.style.animation = ''
    }
    stage.addEventListener('mousemove', onMove)
    stage.addEventListener('mouseleave', onLeave)
    return () => {
      stage.removeEventListener('mousemove', onMove)
      stage.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  return (
    <div className="phone-tilt" ref={ref}>
      <HeroBolt size={168} style={{ top: -74, left: -60 }} rotate={-22} delay="0.8s" />
      <HeroBolt size={96} style={{ bottom: 30, right: -46 }} rotate={28} delay="2s" tone="amber" />
      <HeroBolt size={64} style={{ top: 96, right: -58 }} rotate={-64} delay="3.2s" />
      <HeroBolt size={52} style={{ bottom: -34, left: 6 }} rotate={16} delay="4.4s" tone="amber" />

      <div className="iphone">
        {/* botões laterais */}
        <span className="side-btn action" />
        <span className="side-btn vol-up" />
        <span className="side-btn vol-down" />
        <span className="side-btn power" />

        <div className="iphone-screen">
          <div className="island">
            <span className="lens" />
          </div>

          <div className="status-bar">
            <span className="sb-time">9:41</span>
            <span className="sb-icons">
              <svg width="15" height="10" viewBox="0 0 18 12" fill="currentColor" aria-hidden="true">
                <rect x="0" y="8" width="3" height="4" rx="1" />
                <rect x="4.5" y="6" width="3" height="6" rx="1" />
                <rect x="9" y="3" width="3" height="9" rx="1" />
                <rect x="13.5" y="0" width="3" height="12" rx="1" />
              </svg>
              <svg width="14" height="10" viewBox="0 0 16 12" fill="currentColor" aria-hidden="true">
                <path d="M8 11.2 6 8.9a3 3 0 0 1 4 0l-2 2.3Z" />
                <path d="M8 6.2c1.4 0 2.7.5 3.7 1.4l1.3-1.5A8 8 0 0 0 8 4a8 8 0 0 0-5 1.8l1.3 1.5A5.5 5.5 0 0 1 8 6.2Z" opacity=".9" />
                <path d="M8 1.5c2.5 0 4.8.9 6.6 2.4L16 2.4A11 11 0 0 0 8 0 11 11 0 0 0 0 2.4l1.4 1.5A10 10 0 0 1 8 1.5Z" opacity=".55" />
              </svg>
              <span className="sb-batt">
                <span className="lvl" />
              </span>
            </span>
          </div>

          <div className="mini-app">
            <div className="mini-greet">
              <div>
                <div className="hi">{t('Oi, André 👋', 'Hi, André 👋')}</div>
                <div className="sub">Apto 1204 · Ed. Aurora</div>
              </div>
              <div className="mini-avatar">AR</div>
            </div>

            <div className="mini-card charge">
              <div className="k">
                <span className="dot" /> Carregador livre agora
              </div>
              <div className="v">Bora carregar?</div>
              <div className="cta">Carregar agora</div>
            </div>

            <div className="mini-card">
              <div className="k">{t('Próxima reserva', 'Next booking')}</div>
              <div className="v" style={{ fontSize: 14 }}>
                {t('ter · 05:00 – 07:00', 'Tue · 05:00 – 07:00')}
              </div>
            </div>

            <div className="mini-volt">
              <Volt size={38} />
              <div className="bubble">
                {t('Hoje o melhor horário é', 'Today the best time is')} <b>{t('às 3h', 'at 3 am')}</b>{t(', pela metade do preço! 🌙', ', half the price! 🌙')}
              </div>
            </div>

            <div className="mini-nav">
              <div className="it on">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 10.5 12 3l9 7.5V21H3z" />
                </svg> {t('Início', 'Home')}
              </div>
              <div className="it">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="3" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg> {t('Agendar', 'Book')}
              </div>
              <div className="it">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg> {t('Fatura', 'Bill')}
              </div>
              <div className="it">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
                </svg> {t('Perfil', 'Profile')}
              </div>
            </div>
          </div>

          <span className="home-bar" />
          <span className="glare" />
        </div>
      </div>
    </div>
  )
}

export default function Landing() {
  const navigate = useNavigate()

  return (
    <>
      <VoltChat onAction={() => navigate('/app')} />
      <Nav />

      {/* HERO */}
      <header className="hero">
        <div className="hero-glow" />
        <div className="container hero-inner">
          <div className="hero-copy">
            <HeroBolt size={132} style={{ top: 54, left: -132 }} rotate={-16} delay="1.4s" className="on-copy" />
            <Reveal>
              <span className="hero-badge">
                <span className="dot" /> {t('Recarga compartilhada para condomínios', 'Shared charging for buildings')}
              </span>
            </Reveal>
            <Reveal delay={80}>
              <h1>
                {t('Carregar seu elétrico ficou', 'Charging your EV just got')} <span className="accent">{t('simples.', 'simple.')}</span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="lead">
                {t('Agende seu horário, acompanhe a recarga em tempo real e pague só o que usar. Sem fila, sem planilha, sem discussão na reunião de condomínio.', 'Book your slot, track the charge in real time and pay only for what you use. No queue, no spreadsheet, no arguing at the building meeting.')}
              </p>
            </Reveal>
            <Reveal delay={240}>
              <div className="hero-ctas">
                <Link to="/app" className="btn btn-primary">
                  {t('Experimentar o app', 'Try the app')}
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </Link>
                <a href="#como-funciona" className="btn btn-ghost" onClick={(event) => handleSectionLink(event, 'como-funciona')}>
                  Como funciona
                </a>
              </div>
            </Reveal>
          </div>
          <Reveal delay={200}>
            <PhoneHero />
          </Reveal>
        </div>
      </header>

      {/* BENEFÍCIOS */}
      <section className="section" id="beneficios" style={{ paddingTop: 60 }}>
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <div className="eyebrow">{t('Feito para quem divide', 'Made for people who share')}</div>
              <h2 className="section-title">{t('Um carregador para todos, sem dor de cabeça.', 'One charger for everyone, no headaches.')}</h2>
              <p className="section-sub">
                {t('O Chargefy organiza o uso do carregador do seu prédio como um app de delivery organiza seu jantar: você escolhe, acompanha e paga — tudo na palma da mão.', 'Chargefy organizes your building charger the way a delivery app organizes your dinner: you pick, track and pay, all from your phone.')}
              </p>
            </div>
          </Reveal>
          <div className="cards-3">
            <Reveal delay={0}>
              <div className="b-card">
                <div className="icon green">
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="3" />
                    <path d="M16 2v4M8 2v4M3 10h18M9.5 15.5l2 2 3.5-4" />
                  </svg>
                </div>
                <h3>{t('Agende e esqueça a fila', 'Book and skip the line')}</h3>
                <p>
                  {t('Escolha o melhor horário da semana direto no app. O carregador estará esperando por você — e os horários tranquilos custam bem menos.', 'Pick the best slot of the week right in the app. The charger will be waiting for you, and quiet hours cost a lot less.')}
                </p>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <div className="b-card">
                <div className="icon">
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6M16 13H8M12 17H8" />
                  </svg>
                </div>
                <h3>{t('Fatura sem surpresa', 'No surprise bills')}</h3>
                <p>
                  {t('Cada recarga aparece detalhada, com explicação em português claro do que você pagou e por quê. Nada de rateio misterioso no boleto.', 'Every charge shows up in detail, with a plain-language explanation of what you paid and why. No mystery split on the bill.')}
                </p>
              </div>
            </Reveal>
            <Reveal delay={200}>
              <div className="b-card">
                <div className="icon amber">
                  <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
                  </svg>
                </div>
                <h3>{t('Economize sem esforço', 'Save without effort')}</h3>
                <p>
                  {t('A inteligência do app aprende a rotina do prédio e mostra quando carregar sai mais barato — dá para pagar até metade do preço fora do pico.', 'The app learns your building’s routine and shows when charging costs less. Off-peak can cost up to half the price.')}
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section className="section alt" id="como-funciona">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <div className="eyebrow">{t('Como funciona', 'How it works')}</div>
              <h2 className="section-title">{t('Três passos e pronto.', 'Three steps and done.')}</h2>
            </div>
          </Reveal>
          <div className="steps">
            <Reveal delay={0}>
              <div className="step">
                <h3>{t('Reserve seu horário', 'Book your slot')}</h3>
                <p>
                  {t('Abra o app, veja os horários livres da semana e escolha o que combina com a sua rotina — os mais vazios vêm com desconto.', 'Open the app, see the free slots for the week and pick what fits your routine. The emptier ones come with a discount.')}
                </p>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <div className="step">
                <h3>{t('Encoste o cartão e plugue', 'Tap your card and plug in')}</h3>
                <p>
                  {t('Seu cartão do prédio identifica você no carregador. É só conectar o carro e ir viver a vida — o app acompanha tudo em tempo real.', 'Your building card identifies you at the charger. Just plug in the car and go live your life. The app tracks everything in real time.')}
                </p>
              </div>
            </Reveal>
            <Reveal delay={200}>
              <div className="step">
                <h3>{t('Receba a fatura clara', 'Get a clear bill')}</h3>
                <p>
                  {t('No fim do mês chega uma fatura só sua, recarga por recarga, com o Volt explicando cada valor. Justo para você e para os vizinhos.', 'At the end of the month you get a bill of your own, charge by charge, with Volt explaining each amount. Fair to you and to your neighbors.')}
                </p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* VOLT */}
      <section className="section" id="volt">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <div className="eyebrow">{t('Seu copiloto de energia', 'Your energy copilot')}</div>
              <h2 className="section-title">{t('Conheça o Volt.', 'Meet Volt.')}</h2>
              <p className="section-sub">
                {t('O Volt vive dentro do app e traduz números em conversa: quanto você gastou, por que custou aquilo e quando vale a pena carregar.', 'Volt lives inside the app and turns numbers into conversation: how much you spent, why it cost that much and when it is worth charging.')}
              </p>
            </div>
          </Reveal>
          <Reveal delay={120}>
            <div className="volt-stage">
              <div className="volt-hero">
                <div className="halo" />
                <Volt size={150} mood="wink" />
              </div>
              <div className="volt-bubbles">
                <div className="chat-bubble user">{t('Volt, por que minha fatura subiu esse mês?', 'Volt, why did my bill go up this month?')}</div>
                <div>
                  <div className="volt-name" style={{ marginBottom: 6 }}>
                    {t('Volt · seu assistente', 'Volt · your assistant')}
                  </div>
                  <div className="chat-bubble">
                    {t('Duas recargas caíram na sexta às 18h, o horário mais disputado do prédio 😅 Se você trocar para', 'Two charges landed on Friday at 6 pm, the busiest hour in the building 😅 If you switch to')}{' '}
                    <b>{t('terça de manhãzinha', 'Tuesday early morning')}</b>{t(', a mesma energia sai', ', the same energy costs')} <span className="hl">{t('quase pela metade', 'almost half')}</span>{'.'}
                    {t('Quer que eu abra o agendamento?', 'Want me to open the booking?')}
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* HARDWARE / GOODWE */}
      {/* MOTOR DE IA */}
      <section className="section alt" id="ia">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <div className="eyebrow">{t('Motor de IA', 'AI engine')}</div>
              <h2 className="section-title">{t('O cérebro por trás do Volt.', 'The brain behind Volt.')}</h2>
              <p className="section-sub" style={{ margin: '0 auto' }}>
                {t('Horário vazio custa até metade; horário disputado, no máximo 1,5×. Quem decide isso é a IA — em três camadas simples.', 'Off-peak costs up to half; contested hours at most 1.5×. AI decides this, in three simple layers.')}
              </p>
            </div>
          </Reveal>

          <div className="ai-grid">
            {[
              {
                icon: <TrendingUp size={19} strokeWidth={1.9} />,
                tag: t('Previsão de demanda', 'Demand forecast'),
                title: t('Aprende quando o carregador é disputado', 'Learns when the charger is in demand'),
                body: t('Regressão sobre o histórico de uso de cada hora e dia da semana: é essa previsão que define o preço de cada recarga, mais barato no vazio e mais caro no pico. Um modelo de machine learning roda ao lado e só passa a cobrar se prever melhor.', 'A regression over the usage history of each hour and weekday: this forecast sets the price of each charge, cheaper when quiet and pricier at peak. A machine learning model runs alongside and only takes over pricing if it predicts better.'),
              },
              {
                icon: <CalendarClock size={19} strokeWidth={1.9} />,
                tag: t('Recomendação', 'Recommendation'),
                title: t('Sugere a melhor hora pra você', 'Suggests the best time for you'),
                body: t('Mostra o horário mais barato do dia e, no agendamento, escolhe sozinho a janela mais barata para chegar à bateria que você quer até o seu prazo.', 'Shows the cheapest time of the day and, when you book, picks the cheapest window on its own to reach the battery level you want by your deadline.'),
              },
              {
                icon: <MessagesSquare size={19} strokeWidth={1.9} />,
                tag: t('O Volt', 'Volt'),
                title: t('Explica tudo em português', 'Explains everything in plain language'),
                body: t('O Volt pega esses números e transforma em conversa: por que a fatura mudou, quando vale carregar e o agendamento da recarga.', 'Volt takes these numbers and turns them into conversation: why the bill changed, when it is worth charging and how to book a charge.'),
                volt: true,
              },
            ].map((c, i) => (
              <Reveal key={c.tag} delay={100 + i * 90}>
                <div className={`ai-card ${'volt' in c ? 'is-volt' : ''}`}>
                  <div className="ai-head">
                    <span className="ai-ic">{c.icon}</span>
                    <span className="ai-tag">{c.tag}</span>
                  </div>
                  <h4>{c.title}</h4>
                  <p>{c.body}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal delay={380}>
            <div className="ai-volt">
              <Volt size={46} mood="grin" />
              <div>
                <div className="volt-name" style={{ marginBottom: 6 }}>
                  {t('Volt · sobre o modelo', 'Volt · about the model')}
                </div>
                <div className="chat-bubble">
                  {t('E aqui ninguém lucra com a sua energia: o que o horário de pico rende a mais volta como', 'Here nobody profits from your energy: whatever peak hours bring in extra comes back as')}{' '}
                  <b>{t('desconto na taxa fixa de quem carregou fora do pico', 'a discount on the fixed fee for whoever charged off-peak')}</b>{t('. Ajudou o prédio, pagou menos. 🤝', '. Helped the building, paid less. 🤝')}
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* RATEIO */}
      <section className="section" id="rateio">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <div className="eyebrow">{t('Rateio justo', 'Fair split')}</div>
              <h2 className="section-title">{t('Da tomada à fatura, sem mistério.', 'From the outlet to the bill, no mystery.')}</h2>
              <p className="section-sub" style={{ margin: '0 auto' }}>
                {t('O carregador mede cada sessão por morador — e o preço certo em cada horário espalha as recargas pelo dia: menos fila no pico, menos carregador parado de madrugada.', 'The charger measures each session per resident, and the right price at each hour spreads charges across the day: shorter queues at peak, less idle charger overnight.')}
              </p>
            </div>
          </Reveal>

          <Reveal delay={100}>
            <div className="rateio-flow">
              {[
                {
                  label: t('Sessão', 'Session'),
                  desc: t('cartão RFID identifica o morador', 'RFID card identifies the resident'),
                  icon: (
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
                    </svg>
                  ),
                },
                {
                  label: t('Medição', 'Metering'),
                  desc: t('kWh reais da sessão', 'actual kWh of the session'),
                  icon: (
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="13" r="8" />
                      <path d="M12 13l3.5-3.5M12 5V2M9 2h6" />
                    </svg>
                  ),
                },
                {
                  label: t('Tarifa', 'Rate'),
                  desc: t('preço do horário usado', 'price of the hour used'),
                  icon: (
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 17l5-6 4 3 6-8 3 4" />
                    </svg>
                  ),
                },
                {
                  label: t('Fatura', 'Bill'),
                  desc: t('individual, por unidade', 'individual, per unit'),
                  icon: (
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <path d="M14 2v6h6M16 13H8M12 17H8" />
                    </svg>
                  ),
                },
              ].map((n, i) => (
                <div className="rateio-node-wrap" key={n.label}>
                  {i > 0 && <span className="rateio-link" aria-hidden="true" />}
                  <div className="rateio-node">
                    <span className="rateio-ic">{n.icon}</span>
                    <b>{n.label}</b>
                    <span>{n.desc}</span>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>

          <div className="rateio-grid">
            <Reveal delay={160}>
              <div className="receipt good-side">
                <div className="receipt-head">
                  <div>
                    <b>Apto 0902</b>
                    <span>{t('96 kWh · madrugadas', '96 kWh · overnight')}</span>
                  </div>
                  <span className="ptag cheap">{t('Fora do pico', 'Off-peak')}</span>
                </div>
                <div className="receipt-row">
                  <span>{t('Taxa fixa', 'Fixed fee')}</span>
                  <b>R$ 37,78</b>
                </div>
                <div className="receipt-row credit">
                  <span>{t('Crédito fora do pico', 'Off-peak credit')}</span>
                  <b>− R$ 9,40</b>
                </div>
                <div className="receipt-cut" aria-hidden="true" />
                <div className="receipt-total">
                  <span>{t('Rateio do mês', 'Monthly split')}</span>
                  <b className="green">R$ 28,38</b>
                </div>
              </div>
            </Reveal>

            <Reveal delay={240}>
              <div className="rateio-engine">
                <div className="engine-talk">
                  <Volt size={44} accessory="glasses" />
                  <div className="engine-bubble peak">
                    {t('Carregou no', 'Charged at')} <b>{t('pico', 'peak')}</b>{t('? Paga um adicional — esse horário é o que todo mundo quer. 😬', '? You pay a surcharge, since that hour is what everyone wants. 😬')}
                  </div>
                </div>
                <svg className="engine-arrow" viewBox="0 0 24 44" aria-hidden="true">
                  <path d="M12 2v32M5 27l7 9 7-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="engine-talk flip">
                  <Volt size={44} mood="love" />
                  <div className="engine-bubble cheap">
                    {t('E cada centavo vira', 'Every cent becomes')} <b>{t('crédito', 'credit')}</b>{t(' de quem carregou no vazio. Valeu por aliviar a rede! 💚', ' for whoever charged off-peak. Thanks for easing the grid! 💚')}
                  </div>
                </div>
                <div className="engine-note">{t('ninguém lucra · o pico financia o desconto', 'nobody profits · peak funds the discount')}</div>
              </div>
            </Reveal>

            <Reveal delay={320}>
              <div className="receipt">
                <div className="receipt-head">
                  <div>
                    <b>Apto 1401</b>
                    <span>8 kWh · qualquer hora</span>
                  </div>
                  <span className="ptag mid">{t('Sem crédito', 'No credit')}</span>
                </div>
                <div className="receipt-row">
                  <span>{t('Taxa fixa', 'Fixed fee')}</span>
                  <b>R$ 37,78</b>
                </div>
                <div className="receipt-row muted">
                  <span>{t('Crédito fora do pico', 'Off-peak credit')}</span>
                  <b>R$ 0,00</b>
                </div>
                <div className="receipt-cut" aria-hidden="true" />
                <div className="receipt-total">
                  <span>{t('Rateio do mês', 'Monthly split')}</span>
                  <b>R$ 37,78</b>
                </div>
              </div>
            </Reveal>
          </div>

        </div>
      </section>

      <section className="hardware-hero" id="hardware">
        <model-viewer
          className="hardware-3d"
          src="/models/byd-dolphin-mini.glb"
          alt="BYD Dolphin Mini"
          camera-controls
          disable-zoom
          disable-pan
          auto-rotate
          auto-rotate-delay="0"
          rotation-per-second="4deg"
          interaction-prompt="none"
          exposure="0.85"
          shadow-intensity="0"
          environment-image="neutral"
          tone-mapping="aces"
          camera-orbit="35deg 65deg auto"
          min-camera-orbit="auto 65deg auto"
          max-camera-orbit="auto 65deg auto"
          min-field-of-view="25deg"
          max-field-of-view="25deg"
        />
        <div className="hardware-scrim" />
        <div className="container hardware-content">
          <div className="charger-stage">
            <svg className="charger-glow-svg" viewBox="0 0 300 520" aria-hidden="true">
              <defs>
                <radialGradient id="chargerGlowGrad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#f472b6" stopOpacity="0.42" />
                  <stop offset="55%" stopColor="#e8185a" stopOpacity="0.18" />
                  <stop offset="100%" stopColor="#e8185a" stopOpacity="0" />
                </radialGradient>
                <filter id="chargerGlowBlur" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="34" />
                </filter>
              </defs>
              <ellipse cx="150" cy="260" rx="120" ry="230" fill="url(#chargerGlowGrad)" filter="url(#chargerGlowBlur)" />
            </svg>
            <img src={hcaG2} alt={t('Carregador GoodWe HCA G2', 'GoodWe HCA G2 charger')} className="charger-img" />
          </div>
          <div className="hardware-copy">
            <Reveal>
              <div className="hardware-intro">
                <div className="eyebrow-goodwe">
                  <span>Powered by</span>
                  <img src={goodweLogo} alt="GoodWe" className="goodwe-logo" />
                </div>
                <h2 className="section-title">{t('O carregador HCA G2, da GoodWe.', 'The HCA G2 charger, by GoodWe.')}</h2>
                <p className="section-sub">
                  {t('Por trás do app existe hardware de verdade: o Chargefy roda sobre o carregador residencial', 'Behind the app is real hardware: Chargefy runs on the home charger')}{' '}
                  <b>HCA G2</b>{t(', feito pela GoodWe — referência global em eletrônica de energia e uma das maiores fabricantes de inversores solares do mundo.', ', made by GoodWe, a global reference in power electronics and one of the largest solar inverter makers in the world.')}
                </p>
              </div>
            </Reveal>
            <Reveal delay={100}>
              <ul className="hardware-specs">
                <li>
                  <b>{t('Carga AC de 7 kW, monofásica, 32 A', '7 kW AC charging, single-phase, 32 A')}</b>
                  <span>{t('Conector Tipo 2 com cabo de 6 m e controle dinâmico de carga, para não sobrecarregar a instalação do prédio.', 'Type 2 connector with a 6 m cable and dynamic load control, so the building wiring is not overloaded.')}</span>
                </li>
                <li>
                  <b>Wi-Fi, LAN, Bluetooth e RS485</b>
                  <span>{t('É o que permite ao app acompanhar cada sessão em tempo real; o rateio e a fatura ficam por conta do Chargefy.', 'This is what lets the app follow each session in real time; the split and the bill are handled by Chargefy.')}</span>
                </li>
                <li>
                  <b>{t('Liberação por cartão RFID, app ou início automático', 'Unlock by RFID card, app or automatic start')}</b>
                  <span>{t('Cada morador encosta o próprio cartão, e é por ele que o Chargefy sabe de quem é cada kWh.', 'Each resident taps their own card, and that is how Chargefy knows whose each kWh is.')}</span>
                </li>
                <li>
                  <b>{t('Integração com inversor e bateria GoodWe', 'Integration with GoodWe inverter and battery')}</b>
                  <span>{t('Modos de prioridade solar e solar com bateria, para carregar com a energia gerada no próprio prédio.', 'Solar priority and solar-plus-battery modes, to charge with the energy the building itself generates.')}</span>
                </li>
                <li>
                  <b>{t('IP66 e proteção diferencial integrada', 'IP66 and built-in residual current protection')}</b>
                  <span>{t('Proteção residual de 30 mA AC e 6 mA DC, contra surto e com parada de emergência; vai em garagem coberta ou área externa.', 'Residual protection of 30 mA AC and 6 mA DC, surge protection and emergency stop; fits covered garages or outdoor areas.')}</span>
                </li>
              </ul>
            </Reveal>
          </div>
        </div>
      </section>

      {/* CONDOMÍNIO */}
      {/* REDE / MAPA */}
      <section className="section" id="rede">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <div className="eyebrow">{t('Rede Chargefy', 'Chargefy network')}</div>
              <h2 className="section-title">{t('Um carregador. O bairro inteiro.', 'One charger. The whole neighborhood.')}</h2>
              <p className="section-sub" style={{ margin: '0 auto' }}>
                {t('Carregador de condomínio fica parado 80% do dia. Na rede Chargefy, esse tempo ocioso vira ponto de recarga para quem está por perto — e receita para quem abriu as portas.', 'A building charger sits idle 80% of the day. On the Chargefy network, that idle time becomes a charging point for nearby drivers, and income for whoever opened the doors.')}
              </p>
            </div>
          </Reveal>
          <Reveal delay={100}>
            <ChargerMap />
          </Reveal>
        </div>
      </section>

      <section className="section alt" id="condominio">
        <div className="container">
          <Reveal>
            <div className="sindico-strip">
              <div>
                <div className="eyebrow">{t('Para síndicos e gestores', 'For building managers')}</div>
                <h3>{t('Gestão completa. Zero planilha.', 'Full management. Zero spreadsheets.')}</h3>
                <p>
                  {t('Do carregador à cobrança, sem conta de cabeça: o Chargefy coleta cada recarga, fecha o rateio do mês e cobra cada unidade por Pix ou boleto. Quando o pagamento cai, a fatura dá baixa sozinha.', 'From the charger to billing, no mental math: Chargefy collects every charge, closes the month’s split and bills each unit by Pix or bank slip. When the payment lands, the bill closes itself.')}
                </p>
              </div>
              <div className="sindico-list">
                {[
                  <>{t('Recargas coletadas do carregador, já atribuídas pelo cartão RFID', 'Charges collected from the charger, already assigned by RFID card')}</>,
                  <>{t('Fatura individual por unidade, fechada todo mês', 'Individual bill per unit, closed every month')}</>,
                  <>{t('Cobrança de todas as unidades por Pix ou boleto em um clique', 'Billing every unit by Pix or bank slip in one click')}</>,
                  <span className="item-chips">
                    {t('Baixa automática quando o pagamento é confirmado:', 'Automatic update when payment is confirmed:')} <span className="ptag cheap">{t('Paga', 'Paid')}</span>{' '}
 <span className="ptag mid">{t('Pendente', 'Pending')}</span> <span className="ptag peak">{t('Atrasada', 'Overdue')}</span>
                  </span>,
                  <>{t('Custo fixo dividido só entre quem usou no mês', 'Fixed cost split only among who used it this month')}</>,
                  <>{t('Tarifa por horário a partir da demanda do próprio prédio', 'Hourly rate based on the building’s own demand')}</>,
                ].map((t, i) => (
                  <div className="item" key={i}>
                    <span className="check">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </span>
                    {t}
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* EQUIPE */}
      <section className="section" id="equipe">
        <div className="container">
          <Reveal>
            <div className="section-head center">
              <div className="eyebrow">{t('Equipe', 'Team')}</div>
              <h2 className="section-title">{t('Quem faz o Chargefy.', 'The people behind Chargefy.')}</h2>
            </div>
          </Reveal>
          <div className="team-grid">
            {TEAM.map((m, i) => (
              <Reveal key={m.rm} delay={i * 80}>
                <a
                  className="team-card"
                  href={m.linkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t(`LinkedIn de ${m.name}`, `${m.name} on LinkedIn`)}
                >
                  <div className="avatar">
                    {photoOf(m.slug) ? <img src={photoOf(m.slug)} alt="" loading="lazy" /> : m.initials}
                  </div>
                  <div className="name">{m.name}</div>
                  <div className="rm">RM {m.rm}</div>
                  <span className="li-badge">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M4.98 3.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM3 9h4v12H3V9Zm7 0h3.8v1.7h.05c.53-.95 1.83-1.95 3.77-1.95C21.6 8.75 23 11 23 14.26V21h-4v-6c0-1.5-.03-3.44-2.1-3.44-2.1 0-2.42 1.63-2.42 3.33V21h-4V9Z" />
                    </svg>
                    LinkedIn
                  </span>
                </a>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta-final">
        <div className="hero-glow" />
        <Reveal>
          <h2>
            {t('Pronto para carregar', 'Ready to charge')} <span style={{ color: 'var(--pink)' }}>{t('sem estresse?', 'stress-free?')}</span>
          </h2>
          <p>{t('Explore o app com dados de demonstração — agende, acompanhe e converse com o Volt.', 'Explore the app with demo data: book, track and chat with Volt.')}</p>
          <Link to="/app" className="btn btn-primary">
            {t('Experimentar o app', 'Try the app')}
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </Link>
        </Reveal>
      </section>

      {/* FOOTER */}
      <footer className="footer">
        <div className="container">
          <div className="footer-partners">
            <span className="fp-label">{t('Enterprise Challenge 2026 · Ciência da Computação', 'Enterprise Challenge 2026 · Computer Science')}</span>
            <div className="fp-logos">
              <img src={goodweLogo} alt="GoodWe" className="p-logo goodwe" />
              {FIAP_LOGO ? (
                <img src={FIAP_LOGO} alt="FIAP" className="p-logo fiap" />
              ) : (
                <span className="p-logo p-word">FIAP</span>
              )}
            </div>
          </div>

          <div className="footer-inner">
            <img src={logo} alt="Chargefy" />
            <div className="meta">
              {t('Enterprise Challenge 2026 · Ciência da Computação · FIAP + GoodWe', 'Enterprise Challenge 2026 · Computer Science · FIAP + GoodWe')}
              <br />
              Carregador GoodWe HCA G2 
            </div>
          </div>
        </div>
      </footer>
    </>
  )
}
