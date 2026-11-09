import { labels } from '../lib/i18n'

type Props = {
  size?: number
  mood?: 'happy' | 'wink' | 'grin' | 'stern' | 'love'
  /** headset de atendimento — só no contexto do chatbot */
  headset?: boolean
  /** acessórios temáticos: óculos de fiscal ou touca de quem carrega de madrugada */
  accessory?: 'glasses' | 'nightcap'
}

type Pose = 'feliz' | 'sorrindo' | 'piscando' | 'apaixonado' | 'atendente' | 'fiscal' | 'madrugada'

const LABEL: Record<Pose, string> = labels({
  feliz: ['Volt, o mascote', 'Volt, the mascot'],
  sorrindo: ['Volt sorrindo', 'Volt smiling'],
  piscando: ['Volt piscando', 'Volt winking'],
  apaixonado: ['Volt apaixonado', 'Volt in love'],
  atendente: ['Volt atendente', 'Volt the assistant'],
  fiscal: ['Volt fiscal', 'Volt the inspector'],
  madrugada: ['Volt de madrugada', 'Volt at night'],
})

function pose({ mood = 'happy', headset, accessory }: Props): Pose {
  if (headset) return 'atendente'
  if (accessory === 'nightcap') return 'madrugada'
  if (accessory === 'glasses' || mood === 'stern') return 'fiscal'
  if (mood === 'love') return 'apaixonado'
  if (mood === 'wink') return 'piscando'
  if (mood === 'grin') return 'sorrindo'
  return 'feliz'
}

/** Volt — o mascote do Chargefy */
export default function Volt(props: Props) {
  const { size = 72 } = props
  const p = pose(props)
  return (
    <img
      src={`/volt/${p}.webp`}
      width={size}
      height={size}
      alt={LABEL[p]}
      draggable={false}
      style={{ display: 'block', objectFit: 'contain', flexShrink: 0 }}
    />
  )
}
