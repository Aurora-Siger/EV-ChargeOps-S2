import { useState } from 'react'
import { api } from '../../../lib/http'
import type { Settings } from '../../../lib/types'
import { useApi } from '../../../lib/useApi'
import { ErrorBox, Field, Loading } from '../ui'
import { useAction } from '../../../lib/useAction'

type Form = { name: string; fixed: string; idle: string; grace: string; dueDay: string; base: string }

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
      <div className="c-label">Parâmetros do rateio</div>
      <fieldset disabled={!canWrite} className="plain-fieldset">
        <Field label="Nome do condomínio">
          <input value={f.name} onChange={set('name')} required />
        </Field>
        <div className="form-2">
          <Field label="Tarifa base (R$/kWh)" hint="custo da concessionária, antes do mult">
            <input value={f.base} onChange={set('base')} inputMode="decimal" required />
          </Field>
          <Field label="Custo fixo mensal (R$)" hint="manutenção, internet, seguro…">
            <input value={f.fixed} onChange={set('fixed')} inputMode="decimal" required />
          </Field>
        </div>
        <div className="form-2">
          <Field label="Ociosidade (R$/min)" hint="tempo plugado depois da carga, lido da telemetria">
            <input value={f.idle} onChange={set('idle')} inputMode="decimal" required />
          </Field>
          <Field label="Carência (min)">
            <input value={f.grace} onChange={set('grace')} inputMode="numeric" required />
          </Field>
        </div>
        <Field label="Dia de vencimento" hint="no mês seguinte ao ciclo (1 a 28)">
          <input value={f.dueDay} onChange={set('dueDay')} inputMode="numeric" required />
        </Field>
      </fieldset>
      <div className="hint-line">
        A tarifa base nova vale para as recargas que entrarem daqui para a frente; as já registradas mantêm a tarifa do dia.
      </div>
      {act.error && <div className="login-error">{act.error}</div>}
      {canWrite ? (
        <button className="btn btn-primary" disabled={act.busy}>
          {act.busy ? 'Salvando…' : saved ? 'Salvo ✓' : 'Salvar'}
        </button>
      ) : (
        <div className="hint-line">Só o gestor (papel administrador) altera estes valores.</div>
      )}
    </form>
  )
}
