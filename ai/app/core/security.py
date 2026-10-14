import hmac

from fastapi import Header, HTTPException

from app.core.config import settings


def require_internal_token(x_internal_token: str = Header(default="")) -> None:
    """O serviço só aceita chamadas do backend TS (rede interna + token)."""
    if not hmac.compare_digest(x_internal_token, settings.ai_internal_token):
        raise HTTPException(status_code=401, detail="unauthorized")
