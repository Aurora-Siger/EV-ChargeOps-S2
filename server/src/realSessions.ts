/**
 * Captura real das 20 sessões de recarga do carregador da FIAP (assets/api-semsportal.json
 * do repositório ev-chargeops-s1, coletada em 2026-06-20), transcritas sem alterar nenhum
 * valor de energia/duração/km. Usado pelo seed de demonstração (seedDemoData.ts e
 * demo/generator.ts), que replica essas recargas no banco e sorteia a partir delas.
 */

export const DEVICE_SN = '57000HPA247L0002'

// Sessões reais capturadas em assets/api-semsportal.json (ev-chargeops-s1), campo
// queryChargeLogList.dataList — transcritas sem alterar nenhum valor de energia/duração/km.
export const REAL_SESSIONS = [
  { start: '2026-06-19 19:27:28', end: '2026-06-20 00:22:24', kwh: 11.49, green: 11.4, min: 296, km: 57.45, serial: '57000HPA247L000220260619192719' },
  { start: '2026-06-17 21:20:26', end: '2026-06-18 03:14:22', kwh: 14.6, green: 14.6, min: 355, km: 73.0, serial: '57000HPA247L000220260617212017' },
  { start: '2026-06-15 20:56:59', end: '2026-06-16 00:05:21', kwh: 6.09, green: 6, min: 190, km: 30.45, serial: '57000HPA247L000220260615205651' },
  { start: '2026-06-14 20:11:10', end: '2026-06-14 20:47:34', kwh: 0.0, green: 0, min: 37, km: 0, serial: '57000HPA247L000220260614201102' },
  { start: '2026-06-13 23:12:09', end: '2026-06-14 02:20:48', kwh: 5.71, green: 5.7, min: 189, km: 28.55, serial: '57000HPA247L000220260613231201' },
  { start: '2026-06-12 21:33:49', end: '2026-06-13 02:13:38', kwh: 10.75, green: 10.7, min: 281, km: 53.75, serial: '57000HPA247L000220260612213340' },
  { start: '2026-06-10 22:37:22', end: '2026-06-11 00:31:19', kwh: 2.34, green: 2.3, min: 115, km: 11.7, serial: '57000HPA247L000220260610223713' },
  { start: '2026-06-10 21:23:01', end: '2026-06-10 22:33:03', kwh: 3.53, green: 0, min: 71, km: 17.65, serial: '57000HPA247L000220260610212253' },
  { start: '2026-06-09 21:00:48', end: '2026-06-10 01:48:28', kwh: 11.24, green: 11.2, min: 289, km: 56.2, serial: '57000HPA247L000220260609210040' },
  { start: '2026-06-07 16:47:24', end: '2026-06-07 21:15:24', kwh: 9.61, green: 9.6, min: 269, km: 48.05, serial: '57000HPA247L000220260607164716' },
  { start: '2026-06-05 10:27:16', end: '2026-06-05 13:11:04', kwh: 4.57, green: 4.5, min: 165, km: 22.85, serial: '57000HPA247L000220260605102707' },
  { start: '2026-06-03 21:05:17', end: '2026-06-04 00:32:29', kwh: 7.11, green: 7.1, min: 208, km: 35.55, serial: '57000HPA247L000220260603210509' },
  { start: '2026-06-01 21:48:53', end: '2026-06-02 00:49:51', kwh: 5.6, green: 5.6, min: 182, km: 28.0, serial: '57000HPA247L000220260601214845' },
  { start: '2026-05-31 19:10:47', end: '2026-06-01 00:59:13', kwh: 14.29, green: 14.2, min: 350, km: 71.45, serial: '57000HPA247L000220260531191038' },
  { start: '2026-05-27 20:55:05', end: '2026-05-28 00:41:09', kwh: 8.12, green: 8.1, min: 227, km: 40.6, serial: '57000HPA247L000220260527205457' },
  { start: '2026-05-25 20:36:26', end: '2026-05-25 23:30:44', kwh: 4.97, green: 4.9, min: 175, km: 24.85, serial: '57000HPA247L000220260525203618' },
  { start: '2026-05-24 17:27:32', end: '2026-05-24 23:17:48', kwh: 14.38, green: 0, min: 351, km: 71.9, serial: '57000HPA247L000220260524172724' },
  { start: '2026-05-22 20:59:21', end: '2026-05-22 23:53:06', kwh: 4.97, green: 4.9, min: 175, km: 24.85, serial: '57000HPA247L000220260522205913' },
  { start: '2026-05-21 21:10:29', end: '2026-05-22 00:28:01', kwh: 6.25, green: 6.2, min: 199, km: 31.25, serial: '57000HPA247L000220260521211021' },
  { start: '2026-05-20 19:48:09', end: '2026-05-21 01:46:15', kwh: 14.57, green: 14.5, min: 359, km: 72.85, serial: '57000HPA247L000220260520194800' },
] as const

export function parse(dt: string): Date {
  return new Date(dt.replace(' ', 'T') + 'Z')
}
