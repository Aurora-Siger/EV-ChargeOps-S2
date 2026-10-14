/**
 * Pix "copia e cola" (BR Code, padrão EMV MPM do Banco Central). Cada campo é
 * id (2) + tamanho (2) + valor; o último (63) é um CRC16-CCITT de tudo que vem antes.
 * Manual: "Manual de Padrões para Iniciação do Pix", BCB.
 */

const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`

/** CRC16-CCITT-FALSE (poly 0x1021, init 0xFFFF), em hex maiúsculo com 4 dígitos. */
export function crc16(payload: string): string {
  let crc = 0xffff
  for (const byte of Buffer.from(payload, 'utf8')) {
    crc ^= byte << 8
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** Nome/cidade no BR Code: ASCII sem acento, maiúsculo, cortado no limite do campo. */
const ascii = (s: string, max: number) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim()
    .toUpperCase()
    .slice(0, max) || 'NA'

export type BrCodeInput = {
  key: string // chave Pix do recebedor
  amountCents: number
  merchantName: string
  merchantCity: string
  txid: string // identificador da cobrança (até 25 alfanuméricos)
  description?: string
}

export function buildBrCode(i: BrCodeInput): string {
  // o campo 26 inteiro tem no máximo 99 caracteres: com chave aleatória (36) sobram ~37 para a descrição
  const gui = field('00', 'br.gov.bcb.pix') + field('01', i.key)
  const room = 99 - gui.length - 4
  const description = i.description && room > 0 ? ascii(i.description, room) : ''
  const account = gui + (description ? field('02', description) : '')
  const txid = i.txid.replace(/[^A-Za-z0-9]/g, '').slice(0, 25) || '***'
  const body =
    field('00', '01') +
    field('01', '12') + // uso único
    field('26', account) +
    field('52', '0000') +
    field('53', '986') + // BRL
    field('54', (i.amountCents / 100).toFixed(2)) +
    field('58', 'BR') +
    field('59', ascii(i.merchantName, 25)) +
    field('60', ascii(i.merchantCity, 15)) +
    field('62', field('05', txid)) +
    '6304'
  return body + crc16(body)
}
