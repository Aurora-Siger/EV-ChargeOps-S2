"""Valores padrão pra `app.core.config.Settings` durante os testes.

`Settings()` falha rápido se faltar variável (intencional pro app real — ver
app/core/config.py), mas isso quebra a COLETA inteira dos testes (não só os que
precisam delas) se ninguém tiver copiado `.env.example` pra `.env` ainda. `setdefault`
não sobrescreve um `.env`/ambiente real que já exista — só garante que `uv run pytest`
funciona de primeira num clone novo, sem segredo nenhum de verdade.
"""

import os

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://test:test@localhost:5432/test")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("AI_INTERNAL_TOKEN", "test-token-not-a-real-secret")
os.environ.setdefault("BACKEND_URL", "http://localhost:3000")
