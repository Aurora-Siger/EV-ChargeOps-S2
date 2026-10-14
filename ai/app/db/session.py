from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)

# Tudo do serviço de IA vive no schema "ai". O schema "public" é do backend TS (Drizzle).
AI_SCHEMA = "ai"


class Base(DeclarativeBase):
    pass
