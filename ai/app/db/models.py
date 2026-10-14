import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import AI_SCHEMA, Base


def _uuid() -> str:
    return str(uuid.uuid4())


class Conversation(Base):
    __tablename__ = "conversation"
    __table_args__ = (Index("conversation_user_idx", "user_id"), {"schema": AI_SCHEMA})

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    # user_id é texto solto (id do Better Auth): sem FK entre schemas de donos diferentes.
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str | None] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    messages: Mapped[list["Message"]] = relationship(back_populates="conversation")


class Message(Base):
    __tablename__ = "message"
    __table_args__ = (Index("message_conv_idx", "conversation_id", "created_at"), {"schema": AI_SCHEMA})

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_uuid)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey(f"{AI_SCHEMA}.conversation.id", ondelete="CASCADE")
    )
    role: Mapped[str] = mapped_column(String)  # user | assistant | tool
    content: Mapped[str] = mapped_column(Text)
    tool_calls: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    conversation: Mapped[Conversation] = relationship(back_populates="messages")
