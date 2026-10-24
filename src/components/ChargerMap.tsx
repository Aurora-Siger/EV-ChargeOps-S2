import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  KIND_COLOR,
  KIND_LABEL,
  distanceKm,
  fmtDistance,
  fmtFree,
  fmtPrice,
  walkMinutes,
  type ChargePoint,
  type PointKind,
} from '../lib/chargePoints'
import { useChargePoints } from '../lib/chargePointsHook'
import { currentTheme } from '../lib/theme'

type Props = {
  /** quando presente, mostra a ação do ponto (app do morador) */
  onChoose?: (p: ChargePoint) => void
  /** texto do botão de ação para o ponto */
  chooseLabel?: (p: ChargePoint) => string
  /** ponto ativo no app (local de recarga atual) */
  activeId?: string
  /** altura do mapa */
  height?: number
  /** condomínios da pessoa logada (sem isso, site público: todo condomínio é "seu") */
  myWorkspaces?: string[]
  /** condomínio ativo no app: referência de distância quando a pessoa está em mais de um */
  activeWorkspaceId?: string
}

type Filter = 'todos' | PointKind

/** tempo em cada ponto no modo automático */
const AUTOPLAY_MS = 3500

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'condominio', label: 'Condomínios' },
  { id: 'parceiro', label: 'Parceiros' },
  { id: 'publico', label: 'Públicos' },
]

/** pino com o raio do Chargefy, desenhado como divIcon do Leaflet */
function pinHtml(p: ChargePoint, selected: boolean) {
  const color = KIND_COLOR[p.kind]
  const busy = p.free === 0
  const badge = p.free === null ? '·' : String(p.free)
  return `
    <div class="lpin ${selected ? 'on' : ''} ${busy ? 'busy' : ''}" style="--pin:${color}">
      ${selected ? '<span class="lpin-pulse"></span>' : ''}
      <span class="lpin-body">
        <svg viewBox="0 0 32 32" width="17" height="17" aria-hidden="true">
          <path d="M17.8 4 8 18h6.2L12.6 28 22.8 13h-6.4L17.8 4Z" fill="${busy ? '#575e70' : color}"/>
        </svg>
      </span>
      <span class="lpin-badge">${badge}</span>
    </div>`
}

/** Referência para distância: o condomínio (o ativo, se houver mais de um), ou o centro dos pontos. */
function homeOf(points: ChargePoint[], activeWorkspaceId?: string) {
  const seu =
    points.find((p) => p.kind === 'seu' && p.workspaceId === activeWorkspaceId) ?? points.find((p) => p.kind === 'seu')
  if (seu) return seu
  const n = points.length || 1
  return { id: '', lat: points.reduce((s, p) => s + p.lat, 0) / n, lon: points.reduce((s, p) => s + p.lon, 0) / n }
}

export default function ChargerMap({ onChoose, chooseLabel, activeId, height = 480, myWorkspaces, activeWorkspaceId }: Props) {
  const { points, loading } = useChargePoints(myWorkspaces)
  const HOME = useMemo(() => homeOf(points, activeWorkspaceId), [points, activeWorkspaceId])
  const hasOtherCondos = points.some((p) => p.kind === 'condominio')
  const [sel, setSel] = useState<string>(activeId ?? '')
  const [filter, setFilter] = useState<Filter>('todos')
  const [paused, setPaused] = useState(false)
  const mapEl = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Record<string, L.Marker>>({})

  const list = useMemo(() => {
    const withDistance = points.map((p) => ({ ...p, km: distanceKm(HOME, p) }))
    const filtered = filter === 'todos' ? withDistance : withDistance.filter((p) => p.kind === filter || p.kind === 'seu')
    return filtered.sort((a, b) => a.km - b.km)
  }, [filter, points, HOME])

  const point = points.find((p) => p.id === sel) ?? points[0] ?? null
  const km = point ? distanceKm(HOME, point) : 0

  /* cria o mapa uma vez */
  useEffect(() => {
    if (!mapEl.current || mapRef.current || points.length === 0) return
    const map = L.map(mapEl.current, {
      center: [HOME.lat, HOME.lon],
      zoom: 15,
      zoomControl: false,
      scrollWheelZoom: false,
    })
    // "Leaflet" é branding opcional da lib e sai; a atribuição dos dados fica (exigência da licença)
    map.attributionControl.setPrefix(false)

    let themeCleanup = () => {}
    // base sem rótulos + rótulos por cima dos pinos deixa o mapa mais limpo
    const cartoKey = import.meta.env.VITE_CARTO_API_KEY as string | undefined
    const keyParam = cartoKey ? `?key=${cartoKey}` : ''
    const tileUrl = (kind: 'nolabels' | 'only_labels') =>
      `https://{s}.basemaps.cartocdn.com/${currentTheme()}_${kind}/{z}/{x}/{y}{r}.png${keyParam}`
    const base = L.tileLayer(tileUrl('nolabels'), {
      attribution: '&copy; OpenStreetMap, &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 20,
      className: 'cmap-tiles',
    }).addTo(map)
    const labels = L.tileLayer(tileUrl('only_labels'), {
      subdomains: 'abcd',
      maxZoom: 20,
      pane: 'shadowPane',
      className: 'cmap-labels',
    }).addTo(map)
    // troca de tema com o mapa aberto: só refaz os tiles
    const onTheme = () => {
      base.setUrl(tileUrl('nolabels'))
      labels.setUrl(tileUrl('only_labels'))
    }
    window.addEventListener('chargefy-theme', onTheme)
    themeCleanup = () => window.removeEventListener('chargefy-theme', onTheme)
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    mapRef.current = map

    for (const p of points) {
      const marker = L.marker([p.lat, p.lon], {
        icon: L.divIcon({ html: pinHtml(p, false), className: 'lpin-wrap', iconSize: [34, 34], iconAnchor: [17, 17] }),
        title: p.name,
        riseOnHover: true,
      })
        .addTo(map)
        .on('click', () => setSel(p.id))
      markersRef.current[p.id] = marker
    }

    return () => {
      themeCleanup()
      map.remove()
      mapRef.current = null
      markersRef.current = {}
    }
  }, [points, HOME.lat, HOME.lon])

  /* redesenha os pinos e centraliza no selecionado */
  useEffect(() => {
    for (const p of points) {
      const marker = markersRef.current[p.id]
      if (!marker) continue
      marker.setIcon(
        L.divIcon({ html: pinHtml(p, p.id === sel), className: 'lpin-wrap', iconSize: [34, 34], iconAnchor: [17, 17] }),
      )
      marker.setZIndexOffset(p.id === sel ? 1000 : 0)
    }
    const target = points.find((p) => p.id === sel)
    if (target && mapRef.current) mapRef.current.panTo([target.lat, target.lon], { animate: true, duration: 0.4 })

    // traz o card selecionado para a área visível da fileira (sem mexer no scroll da página)
    const strip = stripRef.current
    const chip = strip?.querySelector<HTMLElement>(`[data-id="${sel}"]`)
    if (strip && chip) {
      const left = chip.offsetLeft - strip.clientWidth / 2 + chip.clientWidth / 2
      strip.scrollTo({ left, behavior: 'smooth' })
    }
  }, [sel])

  const nudge = (dir: 1 | -1) => {
    stripRef.current?.scrollBy({ left: dir * 260, behavior: 'smooth' })
  }

  /* passa sozinho pelos pontos; para quando o usuário interage */
  useEffect(() => {
    if (paused || list.length < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setTimeout(() => {
      const i = list.findIndex((p) => p.id === sel)
      const next = list[(i + 1) % list.length]
      if (next) setSel(next.id)
    }, AUTOPLAY_MS)
    return () => clearTimeout(t)
  }, [sel, list, paused])

  /* esconde no mapa os pontos filtrados */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const p of points) {
      const marker = markersRef.current[p.id]
      if (!marker) continue
      const visible = filter === 'todos' || p.kind === filter || p.kind === 'seu'
      if (visible) marker.addTo(map)
      else marker.remove()
    }
  }, [filter, points])

  const withTelemetry = points.filter((p) => p.free !== null)
  const totalFree = withTelemetry.reduce((s, p) => s + (p.free ?? 0), 0)
  const totalPlugs = withTelemetry.reduce((s, p) => s + p.total, 0)

  if (!point) {
    return (
      <div className="cmap empty-card">
        {loading ? 'Carregando pontos de recarga…' : 'Nenhum ponto de recarga cadastrado ainda. O gestor cadastra em Painel do gestor → Cadastros.'}
      </div>
    )
  }

  return (
    <div
      className="cmap"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
    >
      <div className="cmap-bar">
        <div className="cmap-bar-stat">
          {totalPlugs > 0 ? (
            <>
              <b>{totalFree}</b> de {totalPlugs} {totalPlugs === 1 ? 'tomada monitorada livre' : 'tomadas monitoradas livres'} agora
            </>
          ) : (
            <>{points.length} pontos de recarga</>
          )}
        </div>
        <div className="cmap-filters">
          {FILTERS.filter((f) => f.id !== 'condominio' || hasOtherCondos).map((f) => (
            <button key={f.id} className={`cmap-filter ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="cmap-canvas" style={{ height }}>
        <div className="cmap-leaflet" ref={mapEl} />
        <span className="cmap-fade top" />
        <span className="cmap-fade bottom" />

        <div className={`cmap-detail ${point.kind}`}>
          <div className="cd-top">
            <span className={`cmap-kind ${point.kind}`}>{KIND_LABEL[point.kind]}</span>
            {point.id === activeId && <span className="cd-active">local atual</span>}
          </div>
          <div className="cmap-name">{point.name}</div>
          <div className="cmap-addr">{point.address}</div>

          <div className="cd-grid">
            <div>
              <span className="k">Disponível</span>
              <span className={`v ${point.free === 0 ? 'busy' : point.free === null ? '' : 'free'}`}>{fmtFree(point)}</span>
            </div>
            <div>
              <span className="k">Potência</span>
              <span className="v">{point.power} kW</span>
            </div>
            <div>
              <span className="k">Tarifa</span>
              <span className="v">
                {fmtPrice(point)}
                {point.kind === 'seu' && point.price !== null && <small> agora</small>}
              </span>
            </div>
            <div>
              <span className="k">Distância</span>
              <span className="v">{point.id === HOME.id ? 'aqui' : fmtDistance(km)}</span>
            </div>
          </div>

          <div className="cd-hours">
            {[point.hours, point.id !== HOME.id && `${walkMinutes(km)} min a pé`].filter(Boolean).join(' · ')}
          </div>

          {onChoose && (
            <button
              className="btn btn-primary btn-sm cmap-cta"
              onClick={() => onChoose(point)}
            >
              {chooseLabel?.(point) ?? 'Escolher'}
            </button>
          )}
        </div>
      </div>

      <div className="cmap-legend">
        <span>
          <i style={{ background: KIND_COLOR.seu }} /> Seu condomínio
        </span>
        {hasOtherCondos && (
          <span>
            <i style={{ background: KIND_COLOR.condominio }} /> Condomínio da rede
          </span>
        )}
        <span>
          <i style={{ background: KIND_COLOR.parceiro }} /> Parceiro da rede
        </span>
        <span>
          <i style={{ background: KIND_COLOR.publico }} /> Público
        </span>
        <span className="cmap-legend-hint">o número no pino é quantas tomadas estão livres</span>
      </div>

      <div className={`cmap-strip-wrap ${paused ? 'paused' : ''}`}>
        <button className="strip-nav prev" onClick={() => nudge(-1)} aria-label="Ver pontos anteriores">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m15 6-6 6 6 6" />
          </svg>
        </button>

        <div className="cmap-strip" ref={stripRef}>
          {list.map((p) => (
            <button
              key={p.id}
              data-id={p.id}
              className={`spot ${p.id === sel ? 'on' : ''}`}
              onClick={() => setSel(p.id)}
            >
              <span className="sp-top">
                <span className="sp-dot" style={{ background: KIND_COLOR[p.kind] }} />
                <span className="sp-name">{p.name}</span>
              </span>
              <span className="sp-meta">
                {p.free !== null && (
                  <>
                    <span className={p.free === 0 ? 'busy' : 'free'}>{fmtFree(p)}</span>
                    <span className="sp-sep" />
                  </>
                )}
                <span>{p.id === HOME.id ? 'aqui' : fmtDistance(p.km)}</span>
                <span className="sp-sep" />
                <span>{fmtPrice(p)}</span>
              </span>
            </button>
          ))}
        </div>

        <button className="strip-nav next" onClick={() => nudge(1)} aria-label="Ver próximos pontos">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      </div>
    </div>
  )
}
