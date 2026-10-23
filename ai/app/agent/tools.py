import json
import re
from datetime import datetime
from typing import Literal

import httpx
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from app.core.config import settings
from app.core.time import BRT
from app.rag.store import search


def _backend_get(path: str, params: dict | None = None) -> str:
    """Tools chamam os endpoints /internal do backend TS: mesmas regras de negócio da API,
    sem acesso direto às tabelas do domínio."""
    r = httpx.get(
        f"{settings.backend_url}{path}",
        params=params,
        headers={"X-Internal-Token": settings.ai_internal_token},
        timeout=8,
    )
    r.raise_for_status()
    return r.text


def _backend_post(path: str, json: dict) -> str:
    """Tool de escrita: mesma autenticação de `_backend_get`, mas erro de regra de negócio (4xx)
    não estoura o turno — devolve a mensagem do backend pro LLM repassar ao usuário."""
    r = httpx.post(
        f"{settings.backend_url}{path}",
        json=json,
        headers={"X-Internal-Token": settings.ai_internal_token},
        timeout=15,
    )
    if r.is_success:
        return r.text
    try:
        return r.json().get("message", r.text)
    except ValueError:
        return r.text


def _user_id(config: RunnableConfig | None) -> str | None:
    """Usuário logado da conversa, posto na config pelo service (nunca vem de argumento do LLM)."""
    return ((config or {}).get("configurable") or {}).get("user_id")


# "até 100", "até 80%": meta de bateria, não horário.
_META = re.compile(r"\bat[ée]\s+\d{2,3}\s*%?|\b\d{2,3}\s*%")
_HORA = re.compile(r"\b\d{1,2}\s*(h\b|:\d{2})|\bmeio[- ]dia\b|\bmeia[- ]noite\b|\bcedo\b")
_PRAZO = re.compile(r"\b(at[ée]|pronto|pronta|antes)\b")
_INICIO = re.compile(r"\b(a partir|depois|plug|come[cç])")


def _kind_da_frase(texto: str | None) -> str | None:
    """O que o horário da última mensagem do morador significa, lido do texto dele e não do
    LLM: "até as 7h", "pronto às 7h" é prazo; qualquer outro horário ("amanhã 7h", "e se eu
    plugar 7h?") é início. Sem horário na mensagem (um "sim", "a opção 2"), não decide."""
    texto = _META.sub(" ", (texto or "").lower())
    if not _HORA.search(texto):
        return None
    return "prazo" if _PRAZO.search(texto) and not _INICIO.search(texto) else "inicio"


NOT_LOGGED_IN = (
    "Usuário não está logado (visitante da landing). Não há fatura nem sessões pessoais para "
    "consultar: explique que ele precisa entrar no app para ver os próprios dados."
)


@tool
def list_stations() -> str:
    """Lista estações e carregadores cadastrados (nome, endereço, potência)."""
    return _backend_get("/internal/stations")


@tool
def get_charger_status() -> str:
    """Consulta o estado ao vivo do carregador: bateria (SOC), potência, se está carregando ou
    livre, e o resumo da última sessão de carga. Vem do coletor SEMS+ (dado real, não mockado).
    Se não houver coleta recente, retorna aviso — não invente o estado nesse caso."""
    return _backend_get("/internal/sems/status")


@tool
def get_recent_charge_sessions(limit: int = 5) -> str:
    """Lista as últimas sessões de recarga do carregador como um todo, de qualquer pessoa
    (início, fim, energia em kWh, duração), direto do log da SEMS. Para as sessões do próprio
    usuário, com valor cobrado, use get_my_sessions."""
    return _backend_get("/internal/sems/charge-log", params={"limit": limit})


@tool
def get_current_price(config: RunnableConfig) -> str:
    """Preço do kWh agora no carregador do usuário (tarifa base × multiplicador de demanda da
    hora), com o nível (cheap/mid/peak) e a regra usada. É o mesmo preço que vai para a fatura.
    Nunca calcule ou estime um preço você mesmo: use sempre esta ferramenta."""
    uid = _user_id(config)
    return _backend_get("/internal/pricing/current", params={"userId": uid} if uid else None)


@tool
def get_price_forecast(config: RunnableConfig, hours_ahead: int = 24) -> str:
    """Preço hora a hora nas próximas horas (padrão 24h), com o horário mais barato (cheapest)
    e o mais caro (peak) já destacados. Use para 'qual o melhor horário pra carregar' ou
    'quando fica mais barato'. É a mesma curva que cobra as sessões e que o app mostra no card
    'melhor horário' — cite o horário pelo campo `local`."""
    uid = _user_id(config)
    params = {"hours": hours_ahead, **({"userId": uid} if uid else {})}
    return _backend_get("/internal/pricing/curve", params=params)


@tool
def get_my_invoice(config: RunnableConfig, period: str | None = None) -> str:
    """Fatura do usuário logado no ciclo (padrão: mês atual; `period` no formato AAAA-MM):
    energia, parte cobrada com o multiplicador, crédito do excedente, cota do custo fixo,
    total, as sessões que compõem o valor (com horário e nível de preço), os lançamentos do
    gestor (`entries`: despesas extras rateadas e ajustes desta pessoa) e as cobranças
    emitidas (Pix/boleto, situação e vencimento). Use para 'quanto vou pagar', 'por que minha
    fatura subiu', 'como economizar' ou 'como pago minha fatura'.
    A comparação com o mês anterior já vem pronta em `comparison` (diferença, direção,
    `partial` se o mês ainda está aberto e `summary`, a frase pra repetir); `null` quando não
    há mês anterior pra comparar. Nunca calcule diferença entre valores você mesmo.
    Valores em centavos: divida por 100 ao falar em reais."""
    uid = _user_id(config)
    if not uid:
        return NOT_LOGGED_IN
    return _backend_get(f"/internal/users/{uid}/invoice", params={"period": period} if period else None)


@tool
def get_my_sessions(config: RunnableConfig, limit: int = 5) -> str:
    """Últimas sessões de recarga do usuário logado, com energia (kWh), horário, multiplicador,
    nível de preço e valor cobrado (centavos). Use para 'quanto eu carreguei' ou 'quanto paguei
    na última recarga'."""
    uid = _user_id(config)
    if not uid:
        return NOT_LOGGED_IN
    return _backend_get(f"/internal/users/{uid}/sessions", params={"limit": limit})


@tool
def search_knowledge(query: str) -> str:
    """Busca em manuais, regras de cobrança (tarifa dinâmica, ociosidade, rateio) e FAQ (RAG)."""
    return "\n---\n".join(search(query)) or "Nada encontrado."


@tool
def schedule_charge(
    config: RunnableConfig,
    target_soc: int,
    kind: Literal["prazo", "inicio"] = "inicio",
    horario: str | None = None,
    hours_from_now: float | None = None,
    confirmed: bool = False,
) -> str:
    """Agenda uma recarga de verdade pro carro do usuário logado (primeiro veículo e carregador
    cadastrados), com meta de bateria target_soc (1-100).

    Quando: prefira `horario`, no horário de Brasília, "AAAA-MM-DD HH:MM" (ex.: "2026-10-14
    07:00"), ou "agora". `hours_from_now` (a partir de agora) só para pedidos relativos ("daqui a
    6 horas"). Até 7 dias. Sem horário nenhum, não passe horario nem hours_from_now: a proposta
    vem com horários de início a partir de agora. Converta você mesmo o que o usuário disser ("amanhã às 7h") para
    esse formato: nunca peça data, formato ou número de horas ao usuário.

    kind diz o que esse horário significa, pelo que o usuário FALOU:
    - "inicio" (padrão): quando a recarga começa; o fim previsto vem na proposta. Horário solto
      é início ("amanhã às 7h", "às 22h", "vou plugar às 22h", "e se eu plugar às 7h?", "a
      partir das 7h", "depois das 7h").
    - "prazo": SÓ quando ele disser que precisa do carro pronto até um horário ("preciso até
      as 12h", "pronto pra amanhã cedo", "até as 7h").

    Fluxo OBRIGATÓRIO: chame primeiro com confirmed=false — NÃO agenda nada, só devolve a
    proposta. Plugado e com prazo, o servidor escolhe a janela mais barata. Fora da tomada, a
    carga só começa quando ele plugar: a proposta traz UM horário de início (e talvez uma
    alternativa), com seu `horario`. Toda pergunta nova sobre outro horário é uma chamada nova com
    confirmed=false — nunca repita opções antigas nem invente regra. Só chame com confirmed=true
    depois que o usuário confirmar explicitamente numa mensagem separada, com kind="inicio" e o
    `horario` da opção escolhida (ou os mesmos valores, no caso plugado). Na resposta, cite os
    horários pelos campos startsLocal e endsLocal, que já estão no horário de Brasília."""
    uid = _user_id(config)
    if not uid:
        return NOT_LOGGED_IN
    if not (1 <= target_soc <= 100):
        return "Meta de bateria inválida: precisa ser entre 1 e 100%."
    kind = _kind_da_frase(((config or {}).get("configurable") or {}).get("user_message")) or kind
    if horario is None and hours_from_now is None:
        kind, horario = "inicio", "agora"  # sem horário: opções a partir de agora, sem perguntar
    hours = _hours_until(horario, hours_from_now)
    if isinstance(hours, str):
        return hours
    if kind == "inicio":
        hours = max(0.0, hours)
    if not ((0.5 if kind == "prazo" else 0) <= hours <= 24 * 7):
        return "Horário inválido: o prazo precisa ser de 30 minutos a 7 dias a partir de agora."
    body = {"targetSoc": target_soc, "hoursFromNow": round(hours, 4), "kind": "deadline" if kind == "prazo" else "start"}
    if confirmed:
        return _backend_post(f"/internal/users/{uid}/schedule-charge", body)
    return _proposal(_backend_post(f"/internal/users/{uid}/schedule-charge/preview", body), target_soc)


def _hours_until(horario: str | None, hours_from_now: float | None) -> float | str:
    """Horas a partir de agora para o `horario` local (ou o `hours_from_now` relativo)."""
    if horario is None:
        return hours_from_now or 0.0
    if horario.strip().lower() == "agora":
        return 0.0
    try:
        when = datetime.strptime(horario.strip(), "%Y-%m-%d %H:%M").replace(tzinfo=BRT)
    except ValueError:
        return (
            f'horario "{horario}" não está em AAAA-MM-DD HH:MM. Converta você mesmo o que o '
            "usuário disse e chame de novo; nunca peça formato ao usuário."
        )
    return (when - datetime.now(BRT)).total_seconds() / 3600



def _reais(cents: int | None) -> str:
    return "sem estimativa" if cents is None else f"R$ {cents / 100:.2f}".replace(".", ",")


def _proposal(raw: str, target_soc: int) -> str:
    """Texto da proposta a partir da prévia do backend (ou a mensagem de erro dele)."""
    try:
        p = json.loads(raw)
    except ValueError:
        return raw
    if not isinstance(p, dict) or "pluggedIn" not in p:
        return raw
    if p.get("kind") != "start" and p["pluggedIn"]:
        return (
            f"Proposta (ainda NÃO agendada): o carro está plugado com {p['currentSoc']}%; meta "
            f"{target_soc}%, pronto até {p['deadlineLocal']} (horário de Brasília), no horário mais "
            "barato dentro do prazo. Pergunte ao usuário se confirma antes de chamar esta "
            "ferramenta de novo com confirmed=true."
        )
    limit = f"a partir de {p['fromLocal']}" if p.get("kind") == "start" else f"até {p['deadlineLocal']}"
    options = p["options"]
    if not options:
        return f"Nenhuma recarga {limit} chega a {target_soc}%. Sugira outro horário, uma meta menor ou mais prazo."

    def cost(o: dict) -> int:
        return o["estimatedCostCents"] or 0

    if p.get("kind") == "start":  # o horário que ele pediu; a alternativa só se for mais barata
        best = options[0]
        other = min(options[1:], key=cost, default=None)
        other = other if other is not None and cost(other) < cost(best) else None
    else:  # prazo: a que o servidor recomenda (início realista, com folga); a outra é já
        best = next((o for o in options if o.get("recommended")), None) or min(options, key=cost)
        other = options[0] if options[0] is not best else None

    def _line(o: dict) -> str:
        start = "começa agora" if o["horario"] == "agora" else f"começa {o['startsLocal']}"
        return f'{start} e fica pronta {o["endsLocal"]}, {_reais(o["estimatedCostCents"])} (horario="{o["horario"]}")'

    plug = "" if p["pluggedIn"] or best["horario"] == "agora" else f" O carro só precisa estar plugado até {best['startsLocal']}."
    alt = f"\nAlternativa, só se ele não quiser essa: {_line(other)}." if other else ""
    # carro já plugado: começa na hora, sem a ressalva de "a bateria só é lida ao plugar"
    forecast = (
        ""
        if p["pluggedIn"]
        else "Diga que o fim é uma previsão e pode se estender um pouco, porque a bateria real só é "
        "lida quando o carro for plugado. "
    )
    return (
        f"Nada agendado ainda. Proposta para chegar a {target_soc}% {limit} (conta a partir de "
        f"{p['assumedStartSoc']}%): {_line(best)}.{plug}{alt}\n"
        "Responda numa frase só com a proposta e pergunte se confirma; não liste horários. "
        f"{forecast}Com o "
        'sim, chame com kind="inicio", o horario da opção e confirmed=true.'
    )


@tool
def navigate_to(tela: Literal["inicio", "agendamento", "fatura", "painel_gestor"]) -> str:
    """Leva o usuário para uma tela do app (não muda dado nenhum, só navegação). Use SÓ quando
    ele pedir explicitamente para ver/ir a algo ("me leva pra fatura", "quero agendar"); NÃO use
    para responder uma pergunta — prefira responder no chat mesmo nesse caso."""
    return f"ok, abrindo a tela: {tela}"


TOOLS = [
    list_stations,
    get_charger_status,
    get_recent_charge_sessions,
    get_current_price,
    get_price_forecast,
    get_my_invoice,
    get_my_sessions,
    search_knowledge,
    schedule_charge,
    navigate_to,
]
