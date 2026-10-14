from datetime import datetime

import pytest

from app.agent.service import _navigation_action


class _Msg:
    def __init__(self, tool_calls=None):
        self.tool_calls = tool_calls


def test_sem_tool_call_nenhum_devolve_none():
    assert _navigation_action([_Msg(), _Msg(tool_calls=[])]) is None


def test_navigate_to_no_meio_de_outras_tool_calls():
    messages = [
        _Msg(tool_calls=[{"name": "get_charger_status", "args": {}}]),
        _Msg(tool_calls=[{"name": "navigate_to", "args": {"tela": "fatura"}}]),
    ]
    assert _navigation_action(messages) == "fatura"


def test_mensagem_sem_atributo_tool_calls_nao_quebra():
    # ToolMessage/HumanMessage de verdade não têm .tool_calls — getattr com default cobre isso
    class _SemToolCalls:
        pass

    assert _navigation_action([_SemToolCalls()]) is None


# ── qual Volt responde: logado (com tools) ou visitante (só dúvidas, sem tools) ──


class _FakeScalars:
    def all(self):
        return []


class _FakeDB:
    """O mínimo de Session que `chat()` usa numa conversa nova, sem banco."""

    def scalar(self, _):
        return None

    def scalars(self, _):
        return _FakeScalars()

    def add(self, _):
        pass

    def add_all(self, _):
        pass

    def flush(self):
        pass

    def commit(self):
        pass


class _Reply:
    content = "ok"


class _FakeGraph:
    def __init__(self):
        self.configs = []

    def invoke(self, _state, config=None):
        self.configs.append(config)
        return {"messages": [_Reply()]}


@pytest.mark.parametrize("authenticated", [True, False])
def test_escolhe_o_volt_pelo_login(monkeypatch, authenticated):
    from app.agent import service

    logado, visitante = _FakeGraph(), _FakeGraph()
    monkeypatch.setattr(service, "agent", logado)
    monkeypatch.setattr(service, "visitor_agent", visitante)

    service.chat(_FakeDB(), "u1", None, "oi", authenticated=authenticated)

    usado, outro = (logado, visitante) if authenticated else (visitante, logado)
    assert len(usado.configs) == 1 and outro.configs == []
    # visitante nunca recebe user_id: nem que o grafo tivesse tool, não teria de quem ler dado
    assert usado.configs[0]["configurable"]["user_id"] == ("u1" if authenticated else None)


def test_volt_do_visitante_nao_tem_tool_nenhuma():
    from app.agent.graph import agent, visitor_agent

    assert "tools" not in visitor_agent.get_graph().nodes
    assert "tools" in agent.get_graph().nodes  # controle: o Volt logado tem


# ── data de hoje no Volt logado (sem ela o modelo pedia a fatura de 2023) ──


def test_today_line_traz_data_mes_atual_e_mes_passado():
    from datetime import datetime

    from app.agent.graph import BRT, today_line

    line = today_line(datetime(2026, 9, 24, 14, 30, tzinfo=BRT))
    assert "quinta, 24/09/2026, 14:30" in line
    assert "Mês atual: 2026-09; mês passado: 2026-08." in line


def test_today_line_em_janeiro_o_mes_passado_e_do_ano_anterior():
    from datetime import datetime

    from app.agent.graph import BRT, today_line

    assert "mês passado: 2025-12" in today_line(datetime(2026, 1, 15, 9, 0, tzinfo=BRT))


def test_prompt_do_logado_leva_a_data_de_hoje():
    from app.agent.graph import BRT, logged_prompt

    msgs = logged_prompt({"messages": [("user", "oi")]})
    assert datetime.now(BRT).strftime("%Y-%m") in msgs[0].content
    assert msgs[1] == ("user", "oi")
