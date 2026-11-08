import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

/**
 * Mapa base do Chargefy: tiles escuros da CARTO sem rótulos e os rótulos por cima dos pinos.
 * Devolve o mapa e a limpeza.
 */
export function createBaseMap(el: HTMLElement, center: [number, number], opts: { zoom?: number; zoomControl?: boolean } = {}) {
  const map = L.map(el, { center, zoom: opts.zoom ?? 15, zoomControl: false, scrollWheelZoom: false })
  // "Leaflet" é branding opcional da lib e sai; a atribuição dos dados fica (exigência da licença)
  map.attributionControl.setPrefix(false)

  const cartoKey = import.meta.env.VITE_CARTO_API_KEY as string | undefined
  const keyParam = cartoKey ? `?key=${cartoKey}` : ''
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png${keyParam}`, {
    attribution: '&copy; OpenStreetMap, &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20,
    className: 'cmap-tiles',
  }).addTo(map)
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png${keyParam}`, {
    subdomains: 'abcd',
    maxZoom: 20,
    pane: 'shadowPane',
    className: 'cmap-labels',
  }).addTo(map)
  if (opts.zoomControl !== false) L.control.zoom({ position: 'bottomright' }).addTo(map)

  return { map, cleanup: () => map.remove() }
}
