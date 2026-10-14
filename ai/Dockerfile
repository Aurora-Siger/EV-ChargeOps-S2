# Serviço de IA (FastAPI). No Coolify: Base Directory "/ai", Dockerfile Location "/ai/Dockerfile".
# Sem domínio público — só a rede interna alcança (ver docs/ARCHITECTURE.md §8).

FROM python:3.12-slim AS deps
COPY --from=ghcr.io/astral-sh/uv:0.12.17 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy
# uv.lock* : usa o lock quando existe (build reproduzível) e resolve quando não existe.
COPY pyproject.toml uv.lock* ./
RUN uv sync --no-dev --no-install-project

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH" \
    PORT=8000

# Usuário criado antes dos COPY: com --chown não há uma segunda cópia do venv na imagem.
# /app/models também criado aqui, com dono "app": training/train.py salva o .joblib ali
# (MODELS_DIR.mkdir(exist_ok=True)) rodando como usuário non-root — sem isso o mkdir falha
# com PermissionError, porque o WORKDIR /app em si pertence a root.
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid 10001 app \
 && mkdir -p /app/models && chown app:app /app/models

COPY --from=deps --chown=app:app /app/.venv /app/.venv
COPY --chown=app:app alembic.ini ./
COPY --chown=app:app migrations ./migrations
COPY --chown=app:app app ./app
# training/ só existe na imagem pra rodar o treino manualmente dentro do próprio container
# de produção (não tem outro jeito de levar um .joblib treinado localmente até lá).
COPY --chown=app:app training ./training
# chmod explícito (em vez de COPY --chmod, que exige BuildKit) para não depender
# do bit de execução sobreviver a um checkout Windows.
COPY docker-entrypoint.sh /usr/local/bin/entrypoint
RUN chmod 0755 /usr/local/bin/entrypoint

USER app
EXPOSE 8000
# slim não traz curl/wget; o healthcheck usa o próprio Python.
# start-period folgado: o primeiro boot aplica as migrations antes de servir.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD python -c "import urllib.request as u,os; u.urlopen('http://127.0.0.1:'+os.environ['PORT']+'/healthz').read()" || exit 1

ENTRYPOINT ["entrypoint"]
