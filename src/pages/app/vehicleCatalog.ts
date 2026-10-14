/**
 * Modelos elétricos pré-configurados pra agilizar o cadastro — os mais vendidos no Brasil em
 * 2026 (fonte: ranking CNN Brasil do 1º semestre). Selecionar um preenche bateria/carga/
 * autonomia automaticamente; o morador ainda pode editar os valores depois.
 *
 * `image`: hotlink direto pro site do fabricante/portal (indicado pelo Matheus) — se o link
 * cair ou bloquear hotlink, o componente cai pro ícone genérico (ver VehicleModal em Perfil.tsx).
 */
export type VehiclePreset = {
  id: string
  brand: string
  model: string
  image: string
  capacityKwh: number
  maxChargeKw: number
  rangeKm: number
}

export const VEHICLE_PRESETS: VehiclePreset[] = [
  {
    id: 'byd-dolphin-mini',
    brand: 'BYD',
    model: 'Dolphin Mini',
    image: 'https://cdn.dealerspace.ai/dealersites/vehicles/versions/byd/foto890_44606.webp',
    capacityKwh: 36.9,
    maxChargeKw: 7,
    rangeKm: 280,
  },
  {
    id: 'byd-dolphin',
    brand: 'BYD',
    model: 'Dolphin',
    image: 'https://www.byd.com/material/byd-site/america-public/header-product-image/dolphin-header-update.png',
    capacityKwh: 42.7,
    maxChargeKw: 7,
    rangeKm: 291,
  },
  {
    id: 'geely-ex2',
    brand: 'Geely',
    model: 'EX2',
    image: 'https://virgola.com.br/_next/image?url=https%3A%2F%2Fstatic.virgola.com.br%2Fimages%2F1-9901.png&w=3840&q=75',
    capacityKwh: 39,
    maxChargeKw: 6.6,
    rangeKm: 289,
  },
  {
    id: 'gwm-ora-03',
    brand: 'GWM',
    model: 'Ora 03',
    image: 'https://www.webmotors.com.br/imagens/prod/379473/GWM_ORA_03_48_KW_ELETRICO_SKIN_37947309530647474.webp',
    capacityKwh: 58,
    maxChargeKw: 6.6,
    rangeKm: 315,
  },
  {
    id: 'volvo-ex30',
    brand: 'Volvo',
    model: 'EX30',
    image:
      'https://service.secureoffersites.com/images/GetEvoxImage?styleid=478459&angle=032&colorCode=717&useoverrides=true&BackGroundColor=white&Type=png&vin=YV4EK3ZK9T2705777&position=1&vehicletype=SUV',
    capacityKwh: 49,
    maxChargeKw: 11,
    rangeKm: 344,
  },
]
