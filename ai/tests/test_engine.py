from datetime import UTC, datetime

from app.pricing import engine
from app.pricing.engine import QuoteRequest, predict_curve, predict_multiplier


def _req(occupancy: float, grid: float, recent_demand: float = 10) -> QuoteRequest:
    return QuoteRequest(
        chargerId="c1", now=datetime(2026, 1, 1, 19, tzinfo=UTC), basePriceCentsKwh=100,
        occupancy=occupancy, gridLoad=grid, recentDemandKwh=recent_demand,
    )


def test_pressao_alta_encarece_e_baixa_barateia():
    assert predict_multiplier(_req(1, 1)).multiplier > 1 > predict_multiplier(_req(0, 0)).multiplier


def test_explicacao_sempre_presente():
    assert predict_multiplier(_req(0.5, 0.5)).applied


def test_demanda_recente_influencia_o_preco():
    # mesma ocupação/carga da rede, só a demanda recente muda — regressão pro bug de antes
    # (recentDemandKwh era recebido e nunca usado no cálculo).
    parado = predict_multiplier(_req(0.5, 0.5, recent_demand=0))
    concorrido = predict_multiplier(_req(0.5, 0.5, recent_demand=16))
    assert concorrido.multiplier > parado.multiplier


def test_sem_modelo_treinado_nao_tem_linha_shadow(monkeypatch):
    monkeypatch.setattr(engine, "_load_shadow_model", lambda: None)
    resp = predict_multiplier(_req(0.5, 0.5))
    assert all(not a.rule.startswith("shadow-") for a in resp.applied)


def test_modelo_shadow_nunca_muda_o_preco_servido(monkeypatch):
    class _FakeModel:
        def predict(self, _X):
            return [0.99]  # pressão bem alta — se influenciasse o preço, daria pra ver

    sem_shadow = predict_multiplier(_req(0.2, 0.2))

    monkeypatch.setattr(engine, "_load_shadow_model", lambda: _FakeModel())
    com_shadow = predict_multiplier(_req(0.2, 0.2))

    assert com_shadow.multiplier == sem_shadow.multiplier
    shadow_rules = [a for a in com_shadow.applied if a.rule.startswith("shadow-")]
    assert len(shadow_rules) == 1
    assert "não decide o preço" in shadow_rules[0].reason


def test_forecast_sem_modelo_treinado_nao_inventa_curva(monkeypatch):
    monkeypatch.setattr(engine, "_load_shadow_model", lambda: None)
    resp = predict_curve(datetime(2026, 1, 1, 12, tzinfo=UTC))
    assert resp.available is False
    assert resp.hours == []
    assert resp.reason


def test_forecast_com_modelo_devolve_uma_hora_por_slot_e_acha_a_mais_barata(monkeypatch):
    class _FakeModel:
        def predict(self, X):
            # pressão = hora do dia normalizada (0h mais barato, meio-dia mais caro) —
            # só pra ter uma curva previsível de testar.
            sin_h = X[0][0]
            return [(sin_h + 1) / 2]

    monkeypatch.setattr(engine, "_load_shadow_model", lambda: _FakeModel())
    resp = predict_curve(datetime(2026, 1, 1, 0, tzinfo=UTC), hours_ahead=6)

    assert resp.available is True
    assert len(resp.hours) == 6
    assert resp.cheapest_at == min(resp.hours, key=lambda h: h.multiplier).at
    assert all(h.multiplier == round(h.multiplier, 4) for h in resp.hours)
