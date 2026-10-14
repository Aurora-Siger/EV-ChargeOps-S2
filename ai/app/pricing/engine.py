"""Motor de precificação.

Contrato: recebe features, devolve um MULTIPLICADOR sobre o preço base + explicação.
Quem aplica piso/teto/salto máximo e persiste a decisão é o backend TS (guardrails),
então nenhum modelo aqui consegue fixar preço sozinho.

O preço servido (`multiplier`) vem sempre da fórmula determinística abaixo — nunca do
modelo treinado. Isso é intencional (ver docs/ARCHITECTURE.md §7.1, "shadow mode"): um
modelo novo entra em `ai/models/` e aparece na explicação como uma linha extra ("shadow"),
mas só passa a decidir o preço depois de vencer o baseline numa avaliação offline e ser
promovido — nunca automaticamente. Treine com `ai/training/train.py`.
"""

from datetime import datetime, timedelta
from math import cos, pi, sin
from pathlib import Path

from pydantic import BaseModel, Field

MODEL_VERSION = "ai-baseline-v1"
SHADOW_MODEL_VERSION = "ai-demand-v1"
MODELS_DIR = Path(__file__).resolve().parent.parent.parent / "models"

# Demanda recente de referência (kWh/h) pra normalizar `recentDemandKwh` num carregador
# típico deste porte (1x GoodWe HCA G2, 7 kW). Reveja se a estação crescer.
TYPICAL_DEMAND_KWH_PER_HOUR = 8.0


class QuoteRequest(BaseModel):
    chargerId: str
    now: datetime
    basePriceCentsKwh: int = Field(gt=0)
    occupancy: float = Field(ge=0, le=1)
    gridLoad: float = Field(ge=0, le=1)
    recentDemandKwh: float = Field(ge=0)
    previousPriceCentsKwh: int | None = None


class AppliedRule(BaseModel):
    rule: str
    multiplier: float
    reason: str


class QuoteResponse(BaseModel):
    multiplier: float
    applied: list[AppliedRule]
    model_version: str = MODEL_VERSION


class HourForecast(BaseModel):
    at: datetime
    multiplier: float


class ForecastResponse(BaseModel):
    available: bool
    reason: str | None = None
    hours: list[HourForecast] = []
    cheapest_at: datetime | None = None
    model_version: str = SHADOW_MODEL_VERSION


def time_features(hour: int, weekday: int) -> list[float]:
    """hora e dia da semana como pares seno/cosseno, pra 23h ficar "vizinha" de 0h e
    domingo de segunda — usado tanto pra treinar (training/train.py) quanto pra prever
    aqui, pra nunca desalinhar as features entre treino e serviço."""
    return [
        sin(2 * pi * hour / 24), cos(2 * pi * hour / 24),
        sin(2 * pi * weekday / 7), cos(2 * pi * weekday / 7),
    ]


_shadow_model = None
_shadow_load_attempted = False


def _load_shadow_model():
    """Carrega o modelo treinado (se existir) uma vez só. Falha em silêncio: um artefato
    ausente ou corrompido nunca pode derrubar uma cotação de preço."""
    global _shadow_model, _shadow_load_attempted
    if _shadow_load_attempted:
        return _shadow_model
    _shadow_load_attempted = True
    path = MODELS_DIR / f"{SHADOW_MODEL_VERSION}.joblib"
    if not path.exists():
        return None
    try:
        import joblib

        _shadow_model = joblib.load(path)
    except Exception:  # noqa: BLE001 — artefato ruim nunca pode derrubar uma cotação
        _shadow_model = None
    return _shadow_model


def predict_multiplier(req: QuoteRequest) -> QuoteResponse:
    # Demanda ~ mistura de ocupação e carga da rede (sinal ao vivo) + demanda recente
    # (momentum: sinaliza uma virada antes de occupancy/gridLoad acompanharem).
    occ_grid_pressure = 0.6 * req.occupancy + 0.4 * req.gridLoad
    demand_ratio = min(req.recentDemandKwh / TYPICAL_DEMAND_KWH_PER_HOUR, 2.0) / 2.0
    pressure = 0.75 * occ_grid_pressure + 0.25 * demand_ratio
    m = 0.85 + 0.6 * pressure  # 0.85 (ocioso) .. 1.45 (saturado)

    applied = [
        AppliedRule(
            rule="demand-pressure",
            multiplier=round(m, 4),
            reason=(
                f"Ocupação/rede em {occ_grid_pressure:.0%}, demanda recente "
                f"{req.recentDemandKwh:.1f}kWh ({demand_ratio:.0%} do típico da estação)"
            ),
        )
    ]

    shadow_model = _load_shadow_model()
    if shadow_model is not None:
        shadow_pressure = float(shadow_model.predict([time_features(req.now.hour, req.now.weekday())])[0])
        shadow_pressure = max(0.0, min(1.0, shadow_pressure))
        applied.append(
            AppliedRule(
                rule=f"shadow-{SHADOW_MODEL_VERSION}",
                multiplier=round(0.85 + 0.6 * shadow_pressure, 4),
                reason=(
                    f"[shadow, não decide o preço] modelo prevê {shadow_pressure:.0%} de "
                    f"pressão típica pra este horário vs. {occ_grid_pressure:.0%} observado agora"
                ),
            )
        )

    return QuoteResponse(multiplier=round(m, 4), applied=applied)


def predict_curve(start: datetime, hours_ahead: int = 24) -> ForecastResponse:
    """Previsão do multiplicador pras próximas `hours_ahead` horas a partir de `start`, usando
    só o modelo shadow (aprende o padrão por hora/dia da semana a partir da telemetria real —
    ver training/train.py). Diferente de `predict_multiplier`, aqui não tem ocupação/rede/demanda
    "ao vivo" pra hora nenhuma além da atual, então a fórmula determinística não serve pro
    futuro — só o modelo aprendido consegue estimar isso.

    Sem modelo treinado ainda, `available=False`: não inventa uma curva plana ou com a
    intuição sintética de `training/train.py` como se fosse previsão de verdade (ver a
    instrução do produto: nada de dado "chutado" apresentado como se fosse real)."""
    model = _load_shadow_model()
    if model is None:
        return ForecastResponse(
            available=False,
            reason="ainda não há modelo treinado com dado real suficiente (ver ai/training/train.py)",
        )
    hours = []
    for h in range(hours_ahead):
        at = start + timedelta(hours=h)
        pressure = float(model.predict([time_features(at.hour, at.weekday())])[0])
        pressure = max(0.0, min(1.0, pressure))
        hours.append(HourForecast(at=at, multiplier=round(0.85 + 0.6 * pressure, 4)))
    cheapest = min(hours, key=lambda h: h.multiplier)
    return ForecastResponse(available=True, hours=hours, cheapest_at=cheapest.at)
