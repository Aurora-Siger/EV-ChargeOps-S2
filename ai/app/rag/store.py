"""RAG: busca semântica na base de conhecimento (pgvector, no mesmo Postgres).

`get_store()` constrói o `PGVector` sob demanda (não na importação do módulo): importar
`app.agent.tools` — e, por tabela, o agente inteiro — não pode depender de um Postgres com
pgvector já no ar. Sem isso, um teste de outra tool, ou um boot em que o Postgres ainda não
subiu, quebrava aqui mesmo sem ninguém ter chamado `search_knowledge`.
"""

from langchain_openai import OpenAIEmbeddings
from langchain_postgres import PGVector

from app.core.config import settings

_store: PGVector | None = None


def get_store() -> PGVector:
    global _store
    if _store is None:
        _store = PGVector(
            embeddings=OpenAIEmbeddings(model=settings.embedding_model, api_key=settings.openai_api_key),
            collection_name="knowledge",
            connection=settings.database_url,
            use_jsonb=True,
        )
    return _store


def search(query: str, k: int = 4) -> list[str]:
    return [d.page_content for d in get_store().similarity_search(query, k=k)]
