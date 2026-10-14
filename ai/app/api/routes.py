from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agent import service as agent_service
from app.core.security import require_internal_token
from app.db.session import SessionLocal
from app.pricing.engine import (
    ForecastResponse,
    QuoteRequest,
    QuoteResponse,
    predict_curve,
    predict_multiplier,
)

router = APIRouter(dependencies=[Depends(require_internal_token)])


def get_db():
    with SessionLocal() as db:
        yield db


class ChatRequest(BaseModel):
    user_id: str
    role: str
    # false = visitante da landing (user_id é um id de navegador, não uma conta)
    authenticated: bool = False
    conversation_id: str | None = None
    message: str = Field(min_length=1, max_length=2000)


class ChatResponse(BaseModel):
    conversation_id: str
    reply: str
    action: str | None = None


class ForecastRequest(BaseModel):
    hoursAhead: int = Field(default=24, ge=1, le=48)


@router.post("/pricing/quote", response_model=QuoteResponse)
def quote(req: QuoteRequest) -> QuoteResponse:
    return predict_multiplier(req)


@router.post("/pricing/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest) -> ForecastResponse:
    return predict_curve(datetime.now(UTC), req.hoursAhead)


@router.post("/agent/chat", response_model=ChatResponse)
def chat(req: ChatRequest, db: Annotated[Session, Depends(get_db)]) -> ChatResponse:
    try:
        conv_id, reply, action = agent_service.chat(
            db, req.user_id, req.conversation_id, req.message, authenticated=req.authenticated
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="conversation not found")
    return ChatResponse(conversation_id=conv_id, reply=reply, action=action)
