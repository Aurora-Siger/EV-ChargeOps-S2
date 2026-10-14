#!/bin/sh
# Postgres precisa estar de pé antes de tudo: o import de app.rag.store abre conexão
# (PGVector) já na subida, então falhar aqui é melhor do que falhar no meio do boot.
set -e

echo "Aguardando Postgres..."
python - <<'PY'
import os, sys, time
from sqlalchemy import create_engine, text

# Fora do loop de propósito: URL malformada estoura já, sem esperar os 60s.
engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
for tentativa in range(1, 31):
    try:
        with engine.connect() as c:
            c.execute(text("SELECT 1"))
        print("Postgres pronto.")
        sys.exit(0)
    except Exception as e:
        print(f"  [{tentativa}/30] indisponivel: {type(e).__name__}", flush=True)
        time.sleep(2)
print("Postgres nao respondeu em ~60s.", file=sys.stderr)
sys.exit(1)
PY

# Idempotente: cria o schema "ai", a extensão vector e as tabelas do agente.
echo "Aplicando migrations (alembic)..."
alembic upgrade head

# Idempotente por id (ver app/rag/seed.py): sem isso, a coleção "knowledge" fica vazia até
# alguém rodar o seed manualmente, e o Volt responde "não encontrei" pra tudo que devia vir
# do RAG (tarifa dinâmica, ociosidade, rateio).
echo "Indexando base de conhecimento (RAG)..."
python -m app.rag.seed

echo "Subindo API em :${PORT}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}"
