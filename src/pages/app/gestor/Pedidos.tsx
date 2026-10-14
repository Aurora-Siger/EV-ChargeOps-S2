import { fmtDate } from '../../../lib/format'
import { api } from '../../../lib/http'
import type { JoinRequest, JoinRequestStatus } from '../../../lib/types'
import { useAction } from '../../../lib/useAction'
import { useApi } from '../../../lib/useApi'
import { Empty, ErrorBox, Loading } from '../ui'

const STATUS_LABEL: Record<JoinRequestStatus, string> = {
  PENDING: 'Aguardando',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
  CANCELLED: 'Cancelado',
}

/**
 * Pedidos de quem mora em outro condomínio e quer carregar aqui (feitos pelo mapa). Aprovado,
 * a pessoa entra como convidada: agenda no carregador daqui e paga só o que consumir.
 */
export default function Pedidos() {
  const requests = useApi<JoinRequest[]>('/api/admin/join-requests')
  const act = useAction()

  const decide = (r: JoinRequest, approve: boolean) => {
    if (!approve && !confirm(`Recusar o pedido de ${r.name}?`)) return
    void act.run(async () => {
      await api(`/api/admin/join-requests/${r.id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' })
      requests.reload()
    })
  }

  if (requests.loading && !requests.data) return <Loading />
  if (requests.error) return <ErrorBox error={requests.error} onRetry={requests.reload} />

  const pending = requests.data?.filter((r) => r.status === 'PENDING') ?? []
  const decided = requests.data?.filter((r) => r.status !== 'PENDING') ?? []

  return (
    <>
      <div className="c">
        <div className="c-label">
          {pending.length === 0 ? 'Nenhum pedido aguardando' : `${pending.length} aguardando resposta`}
        </div>
        <div className="hint-line" style={{ marginTop: 0 }}>
          Moradores de outros condomínios pedem acesso pelo mapa. Quem você aprovar entra como convidado: pode agendar
          aqui e paga só o que carregar, sem entrar no rateio do custo fixo.
        </div>
        {act.error && <div className="login-error">{act.error}</div>}
        {pending.length === 0 && <Empty>Quando alguém pedir acesso, o pedido aparece aqui.</Empty>}
        {pending.map((r) => (
          <div className="act wrap" key={r.id}>
            <div className="info">
              <div className="t">{r.name}</div>
              <div className="s">
                {r.email} · pedido em {fmtDate(r.createdAt)}
                {r.message && ` · “${r.message}”`}
              </div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => decide(r, true)} disabled={act.busy}>
              Aprovar
            </button>
            <button className="link-btn danger" onClick={() => decide(r, false)} disabled={act.busy}>
              recusar
            </button>
          </div>
        ))}
      </div>

      {decided.length > 0 && (
        <div className="c">
          <div className="c-label">Respondidos</div>
          {decided.map((r) => (
            <div className="act wrap" key={r.id}>
              <div className="info">
                <div className="t">{r.name}</div>
                <div className="s">
                  {r.email}
                  {r.decidedAt && ` · ${fmtDate(r.decidedAt)}`}
                </div>
              </div>
              <span className={`ptag ${r.status === 'APPROVED' ? 'cheap' : 'dim'}`}>{STATUS_LABEL[r.status]}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
