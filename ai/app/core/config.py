from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Único lugar que lê variáveis de ambiente. Falha na subida se faltar algo."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    openai_api_key: str
    ai_internal_token: str
    backend_url: str
    chat_model: str = "gpt-4.1-mini"
    embedding_model: str = "text-embedding-3-small"


settings = Settings()  # type: ignore[call-arg]
