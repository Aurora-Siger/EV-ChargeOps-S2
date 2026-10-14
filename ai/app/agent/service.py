from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agent.graph import agent, visitor_agent
from app.db.models import Conversation, Message

HISTORY_WINDOW = 20  # janela curta: controla custo e vazamento de contexto


def _navigation_action(messages: list) -> str | None:
    """Procura uma chamada à tool navigate_to entre as mensagens da rodada e devolve a tela
    pedida, se houver. O texto final do agente já confirma isso em português; isto é só o
    sinal estruturado pro front navegar de verdade."""
    for m in messages:
        for call in getattr(m, "tool_calls", None) or []:
            if call.get("name") == "navigate_to":
                return call.get("args", {}).get("tela")
    return None


def chat(
    db: Session, user_id: str, conversation_id: str | None, text: str, authenticated: bool = False
) -> tuple[str, str, str | None]:
    if conversation_id:
        # Autorização por recurso: a conversa precisa ser do usuário autenticado.
        conv = db.scalar(
            select(Conversation).where(
                Conversation.id == conversation_id, Conversation.user_id == user_id
            )
        )
        if conv is None:
            raise LookupError("conversation not found")
    else:
        conv = Conversation(user_id=user_id, title=text[:60])
        db.add(conv)
        db.flush()

    history = db.scalars(
        select(Message)
        .where(Message.conversation_id == conv.id)
        .order_by(Message.created_at.desc())
        .limit(HISTORY_WINDOW)
    ).all()[::-1]

    # Quem é o usuário vai pela config do grafo, não pelo prompt: as tools de dados pessoais
    # leem daqui, então o LLM não tem como pedir a fatura de outra pessoa. Visitante (landing,
    # sem login) conversa com o Volt só de dúvidas, que não tem tool nenhuma. A mensagem crua
    # também vai junto: o schedule_charge lê dela se o horário é início ou prazo.
    graph = agent if authenticated else visitor_agent
    result = graph.invoke(
        {"messages": [(m.role, m.content) for m in history] + [("user", text)]},
        config={"configurable": {"user_id": user_id if authenticated else None, "user_message": text}},
    )
    reply = str(result["messages"][-1].content)
    action = _navigation_action(result["messages"])

    db.add_all(
        [
            Message(conversation_id=conv.id, role="user", content=text),
            Message(conversation_id=conv.id, role="assistant", content=reply),
        ]
    )
    db.commit()
    return conv.id, reply, action
