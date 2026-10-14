type Props = {
  size?: number
  mood?: 'happy' | 'wink' | 'grin' | 'stern' | 'love'
  /** headset de atendimento — só no contexto do chatbot */
  headset?: boolean
  /** acessórios temáticos: óculos de fiscal ou touca de quem carrega de madrugada */
  accessory?: 'glasses' | 'nightcap'
}

/** Volt — o mascote do Chargefy */
export default function Volt({ size = 72, mood = 'happy', headset = false, accessory }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" role="img" aria-label="Volt, o mascote">
      <defs>
        <linearGradient id="voltBody" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F472B6" />
          <stop offset="100%" stopColor="#E8185A" />
        </linearGradient>
        <linearGradient id="voltHeart" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F87171" />
          <stop offset="100%" stopColor="#B91C1C" />
        </linearGradient>
      </defs>
      {/* faísca / antena */}
      <line x1="60" y1="16" x2="60" y2="7" stroke="#F472B6" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="60" cy="5" r="3.4" fill="#FBBF24" />
      {/* corpo */}
      <rect x="14" y="16" width="92" height="88" rx="34" fill="url(#voltBody)" />
      <rect x="14" y="16" width="92" height="88" rx="34" fill="rgba(255,255,255,0.12)" style={{ mixBlendMode: 'overlay' }} />
      {/* raio no peito */}
      <path d="M66 60 54 78h8l-5 16 14-22h-8l5-12z" fill="rgba(255,255,255,0.92)" />
      {/* olhos */}
      {mood === 'wink' ? (
        <>
          <circle cx="45" cy="46" r="6" fill="#0C0D12" />
          <circle cx="47" cy="44" r="2" fill="#fff" />
          <path d="M69 46 q6 4 12 0" stroke="#0C0D12" strokeWidth="4" strokeLinecap="round" fill="none" />
        </>
      ) : mood === 'stern' ? (
        <>
          {/* fiscal de plantão: sobrancelhas franzidas, olhar de "eu vi isso" */}
          <path d="M37 37 53 42" stroke="#0C0D12" strokeWidth="4" strokeLinecap="round" />
          <path d="M83 37 67 42" stroke="#0C0D12" strokeWidth="4" strokeLinecap="round" />
          <circle cx="45" cy="48" r="5.4" fill="#0C0D12" />
          <circle cx="75" cy="48" r="5.4" fill="#0C0D12" />
          <circle cx="46.6" cy="46.4" r="1.7" fill="#fff" />
          <circle cx="76.6" cy="46.4" r="1.7" fill="#fff" />
        </>
      ) : mood === 'love' ? (
        <>
          {/* apaixonado por quem carrega no vazio: olhos de coração */}
          <path
            d="M45 55c-8-5.5-10.5-12-5.2-15.7 2.6-1.9 5.2.2 5.2 2.7 0-2.5 2.6-4.6 5.2-2.7 5.3 3.7 2.8 10.2-5.2 15.7Z"
            fill="url(#voltHeart)"
          />
          <path
            d="M75 55c-8-5.5-10.5-12-5.2-15.7 2.6-1.9 5.2.2 5.2 2.7 0-2.5 2.6-4.6 5.2-2.7 5.3 3.7 2.8 10.2-5.2 15.7Z"
            fill="url(#voltHeart)"
          />
        </>
      ) : (
        <>
          <circle cx="45" cy="46" r="6" fill="#0C0D12" />
          <circle cx="75" cy="46" r="6" fill="#0C0D12" />
          <circle cx="47" cy="44" r="2" fill="#fff" />
          <circle cx="77" cy="44" r="2" fill="#fff" />
        </>
      )}
      {/* bochechas */}
      <ellipse cx="34" cy="57" rx="5.5" ry="3.5" fill="rgba(255,255,255,0.28)" />
      <ellipse cx="86" cy="57" rx="5.5" ry="3.5" fill="rgba(255,255,255,0.28)" />
      {/* sorriso */}
      {mood === 'grin' ? (
        <>
          {/* boca aberta estilo :D */}
          <path d="M46 58 Q60 80 74 58 Z" fill="#0C0D12" />
          <path d="M50 62 Q60 72 70 62 Q60 66 50 62 Z" fill="#F472B6" />
        </>
      ) : mood === 'stern' ? (
        /* bico torto de quem vai mandar a fatura */
        <path d="M51 64 Q61 61 69 65" stroke="#0C0D12" strokeWidth="4" strokeLinecap="round" fill="none" />
      ) : mood === 'love' ? (
        /* sorriso derretido */
        <path d="M48 60 Q60 74 72 60" stroke="#0C0D12" strokeWidth="4" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M50 60 Q60 69 70 60" stroke="#0C0D12" strokeWidth="4" strokeLinecap="round" fill="none" />
      )}
      {/* óculos redondos de fiscal */}
      {accessory === 'glasses' && (
        <>
          <circle cx="45" cy="46" r="11" fill="none" stroke="#0C0D12" strokeWidth="3.2" />
          <circle cx="75" cy="46" r="11" fill="none" stroke="#0C0D12" strokeWidth="3.2" />
          <path d="M56 46h8" stroke="#0C0D12" strokeWidth="3.2" strokeLinecap="round" />
          <path d="M34 44 22 40M86 44l12-4" stroke="#0C0D12" strokeWidth="3.2" strokeLinecap="round" />
        </>
      )}
      {/* touca de dormir — recarga de madrugada */}
      {accessory === 'nightcap' && (
        <>
          <path
            d="M34 24 Q58 4 86 20 L103 10 Q106 24 90 27 Q62 13 38 29 Z"
            fill="#20222F"
            stroke="#0C0D12"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <circle cx="104" cy="11" r="5" fill="#FBBF24" />
        </>
      )}
      {/* headset — só quando ele está "de plantão" no chat */}
      {headset && (
        <>
          <path d="M20 44a40 40 0 0 1 80 0" stroke="#0C0D12" strokeWidth="5" strokeLinecap="round" fill="none" />
          <rect x="12" y="40" width="14" height="22" rx="6" fill="#0C0D12" />
          <rect x="94" y="40" width="14" height="22" rx="6" fill="#0C0D12" />
          <rect x="15" y="43" width="8" height="16" rx="4" fill="#3B3F52" />
          <rect x="97" y="43" width="8" height="16" rx="4" fill="#3B3F52" />
          <path d="M26 58q-10 4-10 16" stroke="#0C0D12" strokeWidth="4" strokeLinecap="round" fill="none" />
          <circle cx="16" cy="76" r="3" fill="#0C0D12" />
        </>
      )}
    </svg>
  )
}
