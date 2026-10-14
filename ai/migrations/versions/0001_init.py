"""schema ai, pgvector e tabelas do agente

Revision ID: 0001
Revises:
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS ai")
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")  # exige imagem pgvector/pgvector

    op.create_table(
        "conversation",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("user_id", sa.String, nullable=False),
        sa.Column("title", sa.String),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        schema="ai",
    )
    op.create_index("conversation_user_idx", "conversation", ["user_id"], schema="ai")

    op.create_table(
        "message",
        sa.Column("id", sa.String, primary_key=True),
        sa.Column("conversation_id", sa.String, sa.ForeignKey("ai.conversation.id", ondelete="CASCADE")),
        sa.Column("role", sa.String, nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("tool_calls", postgresql.JSONB),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
        schema="ai",
    )
    op.create_index("message_conv_idx", "message", ["conversation_id", "created_at"], schema="ai")
    # As tabelas de embeddings (langchain_pg_*) são criadas pelo PGVector no primeiro uso.


def downgrade() -> None:
    op.drop_table("message", schema="ai")
    op.drop_table("conversation", schema="ai")
