"""Ingestão inicial da base de conhecimento (RAG) que `search_knowledge` consulta.

Conteúdo: regras de cobrança e do produto já documentadas no repo (docs/ARCHITECTURE.md §7,
comentários de `src/lib/voltAssistant.ts`) — promovidas de texto fixo em prompt para
conhecimento buscável e versionado. Sem dado de usuário/condomínio individual aqui.

Rodar (uma vez, ou a cada atualização de conteúdo):

    cd ai && uv run python -m app.rag.seed

Precisa de OPENAI_API_KEY e DATABASE_URL configurados (.env) e do Postgres com pgvector no ar.
`seed()` é idempotente por `id` (mesmo texto reindexa por cima em vez de duplicar).
"""

import hashlib

from langchain_core.documents import Document

from app.rag.store import get_store

KNOWLEDGE: list[tuple[str, str]] = [
    (
        "tarifa-dinamica",
        (
            "A tarifa de recarga varia pela demanda: horários concorridos custam mais, horários "
            "ociosos custam menos. O motor de precificação calcula um multiplicador sobre o preço "
            "base a partir da ocupação do carregador e da carga da rede — nunca fixa um preço "
            "final sozinho. O backend aplica um piso e um teto (guardrails) e limita o quanto o "
            "preço pode subir de uma decisão para a próxima (salto máximo). Se o motor de IA "
            "falhar ou demorar mais de 2 segundos, um motor de regras determinístico local assume "
            "no lugar, então o preço nunca fica indisponível."
        ),
    ),
    (
        "cobranca-ociosidade",
        (
            "Deixar o carro plugado no carregador sem necessidade depois que a carga já terminou "
            "gera uma cobrança extra por ociosidade. Essa cobrança só começa depois de uma "
            "tolerância de 15 minutos parado com a carga completa — os primeiros 15 minutos não "
            "são cobrados."
        ),
    ),
    (
        "rateio-custos-fixos",
        (
            "Os custos fixos da infraestrutura de recarga (manutenção, instalação, taxas) são "
            "rateados entre os moradores que carregaram o veículo no mês, dividido igualmente "
            "entre eles. Quem não usou o carregador naquele mês fica isento do rateio nesse "
            "ciclo. O ciclo de faturamento é mensal."
        ),
    ),
    (
        "agendamento-recarga",
        (
            "O agendamento de recarga não usa blocos fixos de horário. A duração da janela vem de "
            "quanto falta de bateria para a meta desejada (não de um horário padrão), e o sistema "
            "sugere as janelas mais baratas que terminam antes do prazo informado pelo morador."
        ),
    ),
    (
        "pagamento-fatura",
        (
            "A fatura da recarga é emitida quando o gestor fecha o ciclo do mês, com vencimento "
            "no dia configurado do mês seguinte. Na tela Fatura o morador escolhe pagar por Pix "
            "(QR code ou Pix copia e cola, compensa na hora) ou por boleto (linha digitável, "
            "compensa em até 2 dias úteis). Se a fatura já venceu, a cobrança nova vence no dia. "
            "Quando uma forma de pagamento é paga, as outras cobranças abertas daquela fatura são "
            "canceladas e a fatura fica como paga. O gestor acompanha o que foi emitido, pago e "
            "vencido na seção Cobranças do painel."
        ),
    ),
    (
        "escopo-volt",
        (
            "O Volt é o assistente do EVChargeOps: responde sobre status do carregador, histórico "
            "de recargas, tarifa vigente e como funciona a cobrança (tarifa dinâmica, ociosidade, "
            "rateio). Ele não altera preços nem confirma agendamentos — isso é feito no painel. "
            "Ele também ainda não tem acesso à fatura ou ao rateio individual de cada morador."
        ),
    ),
]


def _stable_id(key: str) -> str:
    # id determinístico por chave de conteúdo: reindexar não duplica, só substitui.
    return hashlib.sha256(f"knowledge:{key}".encode()).hexdigest()


def seed() -> None:
    docs = [Document(page_content=text, metadata={"source": key}) for key, text in KNOWLEDGE]
    ids = [_stable_id(key) for key, _ in KNOWLEDGE]
    get_store().add_documents(docs, ids=ids)
    print(f"{len(docs)} documentos indexados na base de conhecimento.")


if __name__ == "__main__":
    seed()
