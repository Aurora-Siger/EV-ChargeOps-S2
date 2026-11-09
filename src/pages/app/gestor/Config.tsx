import { useState } from 'react'
import { api } from '../../../lib/http'
import type { Settings } from '../../../lib/types'
import { useApi } from '../../../lib/useApi'
import { ErrorBox, Field, Loading } from '../ui'
import { useAction } from '../../../lib/useAction'
import { t } from '../../../lib/i18n'

type Form = { name: string; fixed: string; idle: string; grace: string; idleMax: string; dueDay: string; base: string }

const brl = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2).replace('.', ','))
const cents = (v: string) => Math.round(Number(v.replace(',', '.')) * 100)

export default function Config({ canWrite }: { canWrite: boolean }) {
  const { data, error, loading, reload } = useApi<Settings>('/api/admin/settings')
  if (loading && !data) return <Loading />
  if (error) return <ErrorBox error={error} onRetry={reload} />
  if (!data) return null
  return <ConfigForm settings={data} canWrite={canWrite} onSaved={reload} />
}

function ConfigForm({ settings, canWrite, onSaved }: { settings: Settings; canWrite: boolean; onSaved: () => void }) {
  const [f, setF] = useState<Form>({
    name: settings.name,
    fixed: brl(settings.fixedMonthlyCostCents),
    idle: brl(settings.idleCentsPerMinute),
    grace: String(settings.idleGraceMinutes),
    idleMax: brl(settings.idleMaxCentsPerSession),
    dueDay: String(settings.dueDay),
    base: brl(settings.basePriceCentsKwh),
  })
  const [saved, setSaved] = useState(false)
  const act = useAction()

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setSaved(false)
    setF({ ...f, [k]: e.target.value })
  }

  const save = (e: React.FormEvent) => {
    e.preventDefault()
    void act.run(async () => {
      await api('/api/admin/settings', {
        method: 'PUT',
        json: {
          name: f.name,
          fixedMonthlyCostCents: cents(f.fixed),
          idleCentsPerMinute: cents(f.idle),
          idleGraceMinutes: Number(f.grace),
          idleMaxCentsPerSession: f.idleMax.trim() === '' ? null : cents(f.idleMax),
          dueDay: Number(f.dueDay),
          basePriceCentsKwh: cents(f.base),
        },
      })
      setSaved(true)
      onSaved()
    })
  }

  return (
    <form className="c" onSubmit={save}>
      <div className="c-label">{t('Parâmetros do rateio', 'Split parameters')}</div>
      <fieldset disabled={!canWrite} className="plain-fieldset">
        <Field label={t('Nome do condomínio', 'Building name')}>
          <input value={f.name} onChange={set('name')} required />
        </Field>
        <div className="form-2">
          <Field label={t('Tarifa base (R$/kWh)', 'Base rate (R$/kWh)')} hint={t('custo da concessionária, antes do mult', 'utility cost, before the multiplier')}>
            <input value={f.base} onChange={set('base')} inputMode="decimal" required />
          </Field>
          <Field label={t('Custo fixo mensal (R$)', 'Monthly fixed cost (R$)')} hint={t('manutenção, internet, seguro…', 'maintenance, internet, insurance…')}>
            <input value={f.fixed} onChange={set('fixed')} inputMode="decimal" required />
          </Field>
        </div>
        <div className="form-2">
          <Field label={t('Ociosidade (R$/min)', 'Idle fee (R$/min)')} hint={t('tempo plugado depois da carga, lido da telemetria', 'time plugged in after charging, read from telemetry')}>
            <input value={f.idle} onChange={set('idle')} inputMode="decimal" required />
          </Field>
          <Field label={t('Carência (min)', 'Grace period (min)')}>
            <input value={f.grace} onChange={set('grace')} inputMode="numeric" required />
          </Field>
        </div>
        <div className="form-2">
          <Field label={t('Teto da ociosidade (R$)', 'Idle fee cap (R$)')} hint={t('por recarga; vazio, sem teto', 'per charge; empty means no cap')}>
            <input value={f.idleMax} onChange={set('idleMax')} inputMode="decimal" placeholder={t('sem teto', 'no cap')} />
          </Field>
          <Field label={t('Dia de vencimento', 'Due day')} hint={t('no mês seguinte ao ciclo (1 a 28)', 'in the month after the cycle (1 to 28)')}>
            <input value={f.dueDay} onChange={set('dueDay')} inputMode="numeric" required />
          </Field>
        </div>
      </fieldset>
      <div className="hint-line">
        {t('A tarifa base nova vale para as recargas que entrarem daqui para a frente; as já registradas mantêm a tarifa do dia.', 'The new base rate applies to charges recorded from now on; those already recorded keep the rate of their day.')}
      </div>
      {act.error && <div className="login-error">{act.error}</div>}
      {canWrite ? (
        <button className="btn btn-primary" disabled={act.busy}>
          {act.busy ? t('Salvando…', 'Saving…') : saved ? t('Salvo ✓', 'Saved ✓') : t('Salvar', 'Save')}
        </button>
      ) : (
        <div className="hint-line">{t('Só o gestor (papel administrador) altera estes valores.', 'Only the manager (administrator role) can change these values.')}</div>
      )}
    </form>
  )
}
