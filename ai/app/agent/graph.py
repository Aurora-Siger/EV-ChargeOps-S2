from datetime import datetime, timedelta

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from app.agent.prompts import SYSTEM_PROMPT, VISITOR_PROMPT
from app.agent.tools import TOOLS
from app.core.config import settings
from app.core.time import BRT, WEEKDAYS


def today_line(now: datetime | None = None) -> str:
    """Data de hoje pro Volt logado. Sem ela o modelo chuta o ano do treino: "fatura do mês
    passado" virava `period=2023-09` e a resposta saía de um ciclo que nem existe."""
    now = (now or datetime.now(BRT)).astimezone(BRT)
    last_month = now.replace(day=1) - timedelta(days=1)
    return (
        f"Hoje é {WEEKDAYS[now.weekday()]}, {now:%d/%m/%Y}, {now:%H:%M} (horário de Brasília). "
        f"Mês atual: {now:%Y-%m}; mês passado: {last_month:%Y-%m}."
    )


def logged_prompt(state: dict) -> list:
    """Prompt do Volt logado, montado a cada conversa pra data não ficar parada no deploy."""
    return [SystemMessage(f"{SYSTEM_PROMPT}\n\n{today_line()}"), *state["messages"]]


# Único ponto que conhece o provedor de LLM.
llm = ChatOpenAI(
    model=settings.chat_model,
    api_key=settings.openai_api_key,
    temperature=0.4,
    max_tokens=400,
)

agent = create_react_agent(llm, TOOLS, prompt=logged_prompt)

# Volt do site (visitante sem login): só tira dúvidas sobre o produto, com o conhecimento que
# está no próprio prompt. Sem tool nenhuma — nada de dado de carregador, recarga ou fatura, e
# nenhuma ação —, então não há o que vazar nem executar mesmo se alguém contornar o prompt.
visitor_agent = create_react_agent(llm, [], prompt=VISITOR_PROMPT)
