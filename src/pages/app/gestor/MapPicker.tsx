import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface MapPickerProps {
  lat: number | null
  lon: number | null
  onSelect: (lat: number, lon: number) => void
}

export function MapPicker({ lat, lon, onSelect }: MapPickerProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const [showMap, setShowMap] = useState(false)

  useEffect(() => {
    if (!showMap || !mapRef.current) return

    if (!mapInstanceRef.current) {
      const map = L.map(mapRef.current).setView([-23.5505, -46.6333], 12)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)

      map.on('click', (e) => {
        const { lat: clickLat, lng: clickLon } = e.latlng
        onSelect(clickLat, clickLon)
      })

      mapInstanceRef.current = map
    }

    if (lat !== null && lon !== null) {
      const pos = [lat, lon] as [number, number]

      if (markerRef.current) {
        markerRef.current.setLatLng(pos)
      } else {
        markerRef.current = L.marker(pos).addTo(mapInstanceRef.current)
      }

      mapInstanceRef.current.setView(pos)
    }
  }, [showMap, lat, lon, onSelect])

  return (
    <div className="map-picker">
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => setShowMap(!showMap)}
      >
        {showMap ? '✕ Fechar mapa' : '📍 Abrir mapa'}
      </button>

      {showMap && (
        <div ref={mapRef} style={{ width: '100%', height: '300px', marginTop: '12px', borderRadius: '4px' }} />
      )}

      {showMap && lat !== null && lon !== null && (
        <small style={{ display: 'block', marginTop: '8px', color: '#666' }}>
          Clique no mapa para atualizar • Atual: ({lat.toFixed(4)}, {lon.toFixed(4)})
        </small>
      )}
    </div>
  )
}
