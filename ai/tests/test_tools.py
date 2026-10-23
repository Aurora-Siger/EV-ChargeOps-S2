from datetime import datetime

import pytest

from app.agent import tools
from app.core.time import BRT


class _FakeResponse:
    def __init__(self, text: str, status: int = 200):
        self.text = text
        self._status = status

    def raise_for_status(self):
        if self._status >= 400:
            raise RuntimeError(f"http {self._status}")

    @property
    def is_success(self):
        return self._status < 400

    def json(self):
        import json

        return json.loads(self.text)


def _fake_get(calls: list[tuple[str, dict | None]], text: str = "{}"):
    def get(url: str, params=None, headers=None, timeout=None):
        calls.append((url, params))
        assert headers["X-Internal-Token"]  # toda tool interna manda o token
        return _FakeResponse(text)

    return get


def _fake_post(calls: list[tuple[str, dict]], text: str = "{}", status: int = 200):
    def post(url: str, json=None, headers=None, timeout=None):
        calls.append((url, json))
        assert headers["X-Internal-Token"]
        return _FakeResponse(text, status)

    return post


def test_list_stations_chama_o_endpoint_certo(monkeypatch):
    calls: list[tuple[str, dict | None]] = []
    monkeypatch.setattr(tools.httpx, "get", _fake_get(calls, text='[{"name":"Estação A"}]'))

    result = tools.list_stations.invoke({})

    assert calls[0][0].endswith("/internal/stations")
    assert "Estação A" in result


def test_get_recent_charge_sessions_manda_o_limit_como_param(monkeypatch):
    calls: list[tuple[str, dict | None]] = []
    monkeypatch.setattr(tools.httpx, "get", _fake_get(calls))

    tools.get_recent_charge_sessions.invoke({"limit": 3})

    assert calls[0][0].endswith("/internal/sems/charge-log")
    assert calls[0][1] == {"limit": 3}


def test_get_charger_status_chama_o_endpoint_de_sems(monkeypatch):
    calls: list[tuple[str, dict | None]] = []
    monkeypatch.setattr(tools.httpx, "get", _fake_get(calls))

    tools.get_charger_status.invoke({})

    assert calls[0][0].endswith("/internal/sems/status")


LOGADO = {"configurable": {"user_id": "user-1"}}
VISITANTE = {"configurable": {"user_id": None}}


def test_get_current_price_usa_a_curva_cobrada_do_usuario(monkeypatch):
    calls: list[tuple[str, dict | None]] = []
    monkeypatch.setattr(tools.httpx, "get", _fake_get(calls))

    tools.get_current_price.invoke({}, config=LOGADO)

    assert calls[0][0].endswith("/internal/pricing/current")
    assert calls[0][1] == {"userId": "user-1"}


def test_get_price_forecast_le_a_mesma_curva_do_app_nao_o_modelo_shadow(monkeypatch):
    calls: list[tuple[str, dict | None]] = []
    monkeypatch.setattr(tools.httpx, "get", _fake_get(calls))

    tools.get_price_forecast.invoke({"hours_ahead": 6}, config=LOGADO)

    assert calls[0][0].endswith("/internal/pricing/curve")
    assert calls[0][1] == {"hours": 6, "userId": "user-1"}


def test_get_price_forecast_de_visitante_nao_manda_user(monkeypatch):
    calls: list[tuple[str, dict | None]] = []
    monkeypatch.setattr(tools.httpx, "get", _fake_get(calls))

    tools.get_price_forecast.invoke({}, config=VISITANTE)

    assert calls[0][1] == {"hours": 24}


def test_get_my_invoice_usa_o_usuario_da_config(monkeypatch):
    calls: list[tuple[str, dict | None]] = []
    monkeypatch.setattr(tools.httpx, "get", _fake_get(calls, text='{"line":{"totalCents":12845}}'))

    result = tools.get_my_invoice.invoke({"period": "2026-09"}, config=LOGADO)

    assert calls[0][0].endswith("/internal/users/user-1/invoice")
    assert calls[0][1] == {"period": "2026-09"}
    assert "12845" in result


def test_user_id_nao_e_argumento_que_o_llm_possa_passar():
    # a config é injetada pelo grafo; o schema que o LLM vê não tem user_id nem config
    for t in (tools.get_my_invoice, tools.get_my_sessions, tools.get_price_forecast, tools.get_current_price, tools.schedule_charge):
        props = t.tool_call_schema.model_json_schema().get("properties", {})
        assert "config" not in props and "user_id" not in props


def test_visitante_nao_consulta_fatura_nem_sessoes(monkeypatch):
    monkeypatch.setattr(tools.httpx, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("não deveria chamar o backend")))

    assert "não está logado" in tools.get_my_invoice.invoke({}, config=VISITANTE)
    assert "não está logado" in tools.get_my_sessions.invoke({}, config=VISITANTE)


def test_get_my_sessions_manda_o_limit(monkeypatch):
    calls: list[tuple[str, dict | None]] = []
    monkeypatch.setattr(tools.httpx, "get", _fake_get(calls))

    tools.get_my_sessions.invoke({"limit": 3}, config=LOGADO)

    assert calls[0][0].endswith("/internal/users/user-1/sessions")
    assert calls[0][1] == {"limit": 3}


def test_navigate_to_so_sinaliza_a_tela_nao_chama_backend(monkeypatch):
    monkeypatch.setattr(tools.httpx, "get", lambda *a, **k: (_ for _ in ()).throw(AssertionError("não deveria chamar o backend")))

    result = tools.navigate_to.invoke({"tela": "fatura"})

    assert "fatura" in result


def test_navigate_to_rejeita_tela_fora_do_enum():
    with pytest.raises(Exception):  # noqa: B017 — validação do pydantic, tipo varia por versão
        tools.navigate_to.invoke({"tela": "sala_de_reuniao"})


def test_search_knowledge_sem_resultado_nao_quebra(monkeypatch):
    monkeypatch.setattr(tools, "search", lambda query, k=4: [])
    assert tools.search_knowledge.invoke({"query": "nada disso existe"}) == "Nada encontrado."


AGORA = datetime(2026, 10, 13, 19, 13, tzinfo=BRT)


def _relogio(monkeypatch):
    monkeypatch.setattr(tools, "datetime", type("FixedNow", (datetime,), {"now": staticmethod(lambda tz=None: AGORA)}))


def test_schedule_charge_horario_local_vira_horas_a_partir_de_agora(monkeypatch):
    _relogio(monkeypatch)
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(tools.httpx, "post", _fake_post(calls, text='{"status":"SCHEDULED"}'))

    tools.schedule_charge.invoke({"target_soc": 100, "kind": "inicio", "horario": "2026-10-14 07:00", "confirmed": True}, config=LOGADO)

    assert calls[0][1] == {"targetSoc": 100, "hoursFromNow": 11.7833, "kind": "start"}


def test_schedule_charge_agora_e_horario_invalido(monkeypatch):
    _relogio(monkeypatch)
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(tools.httpx, "post", _fake_post(calls, text='{"status":"SCHEDULED"}'))

    tools.schedule_charge.invoke({"target_soc": 100, "kind": "inicio", "horario": "agora", "confirmed": True}, config=LOGADO)
    assert calls[0][1]["hoursFromNow"] == 0
    erro = tools.schedule_charge.invoke({"target_soc": 100, "horario": "amanhã 7h"}, config=LOGADO)
    assert "nunca peça formato ao usuário" in erro and len(calls) == 1


def test_schedule_charge_sem_horario_mostra_inicio_a_partir_de_agora_sem_perguntar(monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(tools.httpx, "post", _fake_post(calls, text='{"status":"ok"}'))

    tools.schedule_charge.invoke({"target_soc": 100}, config=LOGADO)

    assert calls[0][0].endswith("/schedule-charge/preview")
    assert calls[0][1] == {"targetSoc": 100, "hoursFromNow": 0.0, "kind": "start"}


def test_schedule_charge_prazo_com_carro_plugado_pede_a_previa_sem_agendar(monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(tools.httpx, "post", _fake_post(calls, text='{"pluggedIn":true,"kind":"deadline","currentSoc":35,"deadlineLocal":"qua 14/10 7h"}'))

    result = tools.schedule_charge.invoke({"target_soc": 80, "kind": "prazo", "hours_from_now": 10}, config=LOGADO)

    assert calls[0][0].endswith("/internal/users/user-1/schedule-charge/preview")
    assert "NÃO agendada" in result and "35%" in result and "qua 14/10 7h" in result


def test_schedule_charge_prazo_fora_da_tomada_propoe_a_mais_barata_sem_lista(monkeypatch):
    previa = (
        '{"pluggedIn":false,"kind":"deadline","deadlineLocal":"qua 14/10 7h13","assumedStartSoc":20,"options":['
        '{"horario":"agora","startsLocal":"agora","endsLocal":"ter 13/10 23h48","level":"peak","estimatedCostCents":1942},'
        '{"horario":"2026-10-14 02:00","startsLocal":"qua 14/10 2h","endsLocal":"qua 14/10 6h36","level":"cheap","estimatedCostCents":790,"recommended":true},'
        '{"horario":"2026-10-14 01:00","startsLocal":"qua 14/10 1h","endsLocal":"qua 14/10 5h36","level":"cheap","estimatedCostCents":780}]}'
    )
    monkeypatch.setattr(tools.httpx, "post", _fake_post([], text=previa))

    result = tools.schedule_charge.invoke({"target_soc": 100, "kind": "prazo", "hours_from_now": 12}, config=LOGADO)

    proposta, alternativa = result.split("\n")[:2]
    assert "chegar a 100% até qua 14/10 7h13" in proposta
    assert 'começa qua 14/10 2h e fica pronta qua 14/10 6h36, R$ 7,90 (horario="2026-10-14 02:00")' in proposta
    assert "plugado até qua 14/10 2h" in proposta
    assert 'Alternativa' in alternativa and 'começa agora' in alternativa and "R$ 19,42" in alternativa
    assert 'kind="inicio"' in result and "não liste horários" in result and "pode se estender" in result


def test_schedule_charge_inicio_propoe_o_horario_pedido(monkeypatch):
    calls: list[tuple[str, dict]] = []
    previa = (
        '{"pluggedIn":false,"kind":"start","fromLocal":"qua 14/10 7h","assumedStartSoc":20,"options":['
        '{"horario":"2026-10-14 07:00","startsLocal":"qua 14/10 7h","endsLocal":"qua 14/10 11h36","level":"mid","estimatedCostCents":1300},'
        '{"horario":"2026-10-14 08:00","startsLocal":"qua 14/10 8h","endsLocal":"qua 14/10 12h36","level":"peak","estimatedCostCents":1800}]}'
    )
    monkeypatch.setattr(tools.httpx, "post", _fake_post(calls, text=previa))

    result = tools.schedule_charge.invoke({"target_soc": 100, "kind": "inicio", "hours_from_now": 11.8}, config=LOGADO)

    assert calls[0][0].endswith("/schedule-charge/preview") and calls[0][1]["kind"] == "start"
    assert "a partir de qua 14/10 7h" in result and "começa qua 14/10 7h e fica pronta qua 14/10 11h36, R$ 13,00" in result
    assert "Alternativa" not in result  # a das 8h é mais cara: não entra


def test_schedule_charge_sem_horario_que_caiba(monkeypatch):
    monkeypatch.setattr(
        tools.httpx, "post", _fake_post([], text='{"pluggedIn":false,"kind":"deadline","deadlineLocal":"ter 13/10 20h","assumedStartSoc":20,"options":[]}')
    )

    result = tools.schedule_charge.invoke({"target_soc": 100, "hours_from_now": 1}, config=LOGADO)

    assert "Nenhuma recarga até ter 13/10 20h" in result


def test_schedule_charge_previa_repassa_erro_do_backend(monkeypatch):
    monkeypatch.setattr(tools.httpx, "post", _fake_post([], text='{"error":"NO_VEHICLE","message":"Você ainda não tem um carro cadastrado"}', status=400))

    assert "carro cadastrado" in tools.schedule_charge.invoke({"target_soc": 80, "hours_from_now": 6}, config=LOGADO)


def test_schedule_charge_visitante_nao_agenda(monkeypatch):
    monkeypatch.setattr(tools.httpx, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("não deveria chamar o backend")))

    assert "não está logado" in tools.schedule_charge.invoke({"target_soc": 80, "hours_from_now": 6, "confirmed": True}, config=VISITANTE)


def test_schedule_charge_valida_faixa_antes_de_chamar_o_backend(monkeypatch):
    monkeypatch.setattr(tools.httpx, "post", lambda *a, **k: (_ for _ in ()).throw(AssertionError("não deveria chamar o backend")))

    assert "inválida" in tools.schedule_charge.invoke({"target_soc": 150, "hours_from_now": 6}, config=LOGADO)
    assert "inválido" in tools.schedule_charge.invoke({"target_soc": 80, "hours_from_now": 999}, config=LOGADO)


def test_schedule_charge_confirmed_chama_o_endpoint_certo(monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(tools.httpx, "post", _fake_post(calls, text='{"mode":"now","status":"SCHEDULED"}'))

    result = tools.schedule_charge.invoke({"target_soc": 80, "hours_from_now": 6, "confirmed": True}, config=LOGADO)

    assert calls[0][0].endswith("/internal/users/user-1/schedule-charge")
    assert calls[0][1] == {"targetSoc": 80, "hoursFromNow": 6, "kind": "start"}
    assert "SCHEDULED" in result


def test_schedule_charge_inicio_vira_start_no_backend(monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(tools.httpx, "post", _fake_post(calls, text='{"status":"SCHEDULED"}'))

    tools.schedule_charge.invoke({"target_soc": 80, "hours_from_now": 3, "kind": "inicio", "confirmed": True}, config=LOGADO)

    assert calls[0][1]["kind"] == "start"


def test_schedule_charge_confirmed_devolve_mensagem_de_erro_do_backend(monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(tools.httpx, "post", _fake_post(calls, text='{"error":"NO_VEHICLE","message":"Você ainda não tem um carro cadastrado"}', status=400))

    result = tools.schedule_charge.invoke({"target_soc": 80, "hours_from_now": 6, "confirmed": True}, config=LOGADO)

    assert "carro cadastrado" in result


@pytest.mark.parametrize(
    ("frase", "kind"),
    [
        ("posso amanha 7h", "inicio"),
        ("e plugar 7h?", "inicio"),
        ("Agendar recarga. Bateria atual: 20%. Preciso até 100 amanhã às 7h", "inicio"),
        ("a partir das 7h, quero até 80%", "inicio"),
        ("preciso do carro pronto até as 12h", "prazo"),
        ("até 7h de amanhã", "prazo"),
        ("Preciso até 100", None),
        ("sim, pode ser a opção 2", None),
    ],
)
def test_kind_sai_da_frase_do_morador(frase, kind):
    assert tools._kind_da_frase(frase) == kind


def test_schedule_charge_horario_solto_e_inicio_mesmo_se_o_llm_mandar_prazo(monkeypatch):
    _relogio(monkeypatch)
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(tools.httpx, "post", _fake_post(calls, text='{"status":"ok"}'))
    config = {"configurable": {"user_id": "user-1", "user_message": "posso amanha 7h"}}

    tools.schedule_charge.invoke({"target_soc": 100, "kind": "prazo", "horario": "2026-10-14 07:00"}, config=config)

    assert calls[0][1]["kind"] == "start"


def test_schedule_charge_meta_em_km_vai_pro_backend_converter(monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(tools.httpx, "post", _fake_post(calls, text='{"status":"ok"}'))

    tools.schedule_charge.invoke({"target_km": 200}, config=LOGADO)

    assert calls[0][1] == {"targetKm": 200, "hoursFromNow": 0.0, "kind": "start"}


def test_schedule_charge_proposta_fala_em_km_e_sugere_mais_sem_meta(monkeypatch):
    previa = (
        '{"vehicleModel":"BYD Dolphin Mini","targetSoc":80,"targetKm":224,"fullRangeKm":280,"defaultTarget":true,'
        '"pluggedIn":false,"kind":"start","fromLocal":"ter 13/10 22h","assumedStartSoc":20,"options":['
        '{"horario":"2026-10-13 22:00","startsLocal":"ter 13/10 22h","endsLocal":"ter 13/10 23h30","level":"mid","estimatedCostCents":900}]}'
    )
    monkeypatch.setattr(tools.httpx, "post", _fake_post([], text=previa))

    result = tools.schedule_charge.invoke({"horario": "agora"}, config=LOGADO)

    assert "chegar a ~224 km de autonomia (80%)" in result
    assert "meta do dia a dia" in result and "~280 km" in result
    assert "target_soc=80" in result


def test_km_na_frase_nao_vira_horario():
    assert tools._kind_da_frase("preciso de uns 200 km") is None
