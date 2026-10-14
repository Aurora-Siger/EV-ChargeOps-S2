from alembic import context
from sqlalchemy import text

from app.db import models  # noqa: F401  (registra as tabelas)
from app.db.session import AI_SCHEMA, Base, engine

target_metadata = Base.metadata


def run_migrations() -> None:
    with engine.connect() as conn:
        conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {AI_SCHEMA}"))
        conn.commit()
        context.configure(
            connection=conn,
            target_metadata=target_metadata,
            include_schemas=True,
            # Só enxerga o schema "ai": jamais tenta alterar tabelas do Drizzle.
            include_name=lambda name, type_, _: type_ != "schema" or name == AI_SCHEMA,
            version_table_schema=AI_SCHEMA,
        )
        with context.begin_transaction():
            context.run_migrations()


run_migrations()
