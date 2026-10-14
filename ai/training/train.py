"""Treina um modelo de PREVISÃO DE DEMANDA — não de preço — a partir da telemetria real do
carregador da FIAP (public.sems_power_point, a série de potência; antes dela, public.sems_snapshot
kind='detail'): "às 19h de sexta, qual pressão de
uso é típica neste carregador?". Isso substitui, em shadow, a suposição genérica embutida na
fórmula do motor por um padrão aprendido dos dados reais desta estação.

Por que sems_snapshot e não pricing_decision: pricing_decision só ganha uma linha quando
alguém chama o endpoint de cotação — pré-lançamento, isso é raro ou inexistente. Já
sems_snapshot é alimentada continuamente em produção (server/src/modules/sems/sems.collector.ts
faz polling a cada SEMS_POLL_INTERVAL_MS e salva) — é o dado real que já está acumulando de
verdade, direto do carregador físico.

Por que não treinar direto pra prever o preço: o preço já cobrado é gerado pela própria
fórmula do motor (`app/pricing/engine.py`) — um modelo treinado nele só aprenderia a imitar
essa fórmula, não a melhorá-la (circular). Prever a pressão de demanda a partir só do
horário é uma tarefa diferente e genuína: hoje a fórmula assume implicitamente que todo
horário "igual" (mesma hora, mesmo dia da semana) tem a mesma demanda; o modelo aprende se
isso é verdade pra ESTE carregador.

Uso:
    cd ai && uv run python -m training.train --synthetic 2000   # testa o pipeline com seed sintético
    cd ai && uv run python -m training.train                    # lê a telemetria real (sems_power_point)

`--synthetic` é o seed: prova que o pipeline (carga → features → treino → avaliação →
versionamento) funciona de ponta a ponta antes de haver telemetria real suficiente, ou pra
testar sem depender de Postgres. O modo padrão lê a telemetria real acumulada pelo
carregador da FIAP. Salva em ai/models/ só se vencer um baseline ingênuo (ver
docs/ARCHITECTURE.md §7.1: "modelo que não vence o baseline não é promovido") — o motor
carrega o artefato salvo em SHADOW (nunca decide o preço sozinho).
"""

import argparse
import json
import random
from datetime import UTC, datetime, timedelta
from pathlib import Path

import joblib
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

from app.pricing.engine import SHADOW_MODEL_VERSION, time_features

MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

# Mesma curva de intuição de domínio usada no front pra demo (src/lib/energyPricing.ts):
# pico às 19h, vale de madrugada. Só usada aqui pra GERAR dado sintético plausível pro
# pipeline ter o que treinar — o modelo de verdade aprende dos dados reais, não desta lista.
_REFERENCE_CURVE = [
    0.10, 0.05, 0.02, 0.02, 0.05, 0.12, 0.28, 0.42, 0.48, 0.44, 0.38, 0.35,
    0.38, 0.40, 0.36, 0.34, 0.40, 0.62, 0.95, 1.00, 0.90, 0.60, 0.35, 0.18,
]


def _synthetic_dataset(n: int, seed: int = 42) -> tuple[list[list[float]], list[float]]:
    rng = random.Random(seed)
    X: list[list[float]] = []
    y: list[float] = []
    start = datetime(2026, 1, 1, tzinfo=UTC)
    for _ in range(n):
        dt = start + timedelta(hours=rng.randint(0, 24 * 90))
        hour, weekday = dt.hour, dt.weekday()
        pressure = _REFERENCE_CURVE[hour]
        if weekday >= 5 and 16 <= hour <= 21:  # fim de semana: pico da noite mais suave
            pressure *= 0.72
        pressure = max(0.0, min(1.0, pressure + rng.gauss(0, 0.06)))
        X.append(time_features(hour, weekday))
        y.append(pressure)
    return X, y


def _real_dataset() -> tuple[list[list[float]], list[float], str]:
    """Telemetria real do carregador da FIAP, coletada a cada poll em produção por
    sems.collector.ts (psycopg direto, sem ORM: este script não depende do schema do server/
    além das próprias tabelas). A pressão de uso é potência entregue / potência máxima
    (0 = ocioso, 1 = na potência máxima).

    Fonte preferida: public.sems_power_point, a série de potência (pEvChar) a cada 5 min. O
    `detail` de public.sems_snapshot congelou em "cabo fora" desde 19/09/2026, então só serve
    de fonte enquanto ainda não há série de potência gravada; dele saem dynamicLoad e
    chargeMaxPower, ignorando leituras em fault."""
    import psycopg

    from app.core.config import settings

    X: list[list[float]] = []
    y: list[float] = []
    dsn = settings.database_url.replace("postgresql+psycopg://", "postgresql://")
    with psycopg.connect(dsn) as conn:
        power = conn.execute("select at, kw from public.sems_power_point order by at").fetchall()
        detail = conn.execute(
            "select collected_at, payload from public.sems_snapshot where kind = 'detail' order by collected_at"
        ).fetchall()

    max_powers = [p.get("chargeMaxPower") for _, p in detail if p.get("chargeMaxPower")]
    if len(power) >= 50 and max_powers:
        max_power = float(max_powers[-1])
        for at, kw in power:
            X.append(time_features(at.hour, at.weekday()))
            y.append(max(0.0, min(1.0, kw / max_power)))
        return X, y, "public.sems_power_point"

    for collected_at, payload in detail:
        if payload.get("workState") == "fault":
            continue
        max_power = payload.get("chargeMaxPower")
        dynamic_load = payload.get("dynamicLoad")
        if not max_power or dynamic_load is None:
            continue
        pressure = max(0.0, min(1.0, dynamic_load / max_power))
        X.append(time_features(collected_at.hour, collected_at.weekday()))
        y.append(pressure)
    return X, y, "public.sems_snapshot"


def train(X: list[list[float]], y: list[float]) -> tuple[GradientBoostingRegressor, dict]:
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    model = GradientBoostingRegressor(random_state=42)
    model.fit(X_train, y_train)
    mae = mean_absolute_error(y_test, model.predict(X_test))

    # baseline ingênuo: "a pressão é sempre a média histórica, hora nenhuma importa".
    # É o piso mínimo de qualidade — o modelo só é útil se aprender o padrão por horário.
    naive_pred = [sum(y_train) / len(y_train)] * len(y_test)
    naive_mae = mean_absolute_error(y_test, naive_pred)

    return model, {"mae": mae, "naive_baseline_mae": naive_mae, "n_train": len(X_train), "n_test": len(X_test)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--synthetic", type=int, default=0, metavar="N",
        help="gera N leituras sintéticas (seed) em vez de ler public.sems_snapshot (testa o pipeline sem dado real)",
    )
    args = parser.parse_args()

    if args.synthetic:
        print(f"Gerando {args.synthetic} leituras sintéticas (seed — não é dado real de produção)…")
        X, y = _synthetic_dataset(args.synthetic)
        source = "synthetic"
    else:
        print("Lendo a telemetria real do carregador da FIAP…")
        X, y, source = _real_dataset()
        print(f"Fonte: {source} ({len(X)} leituras)")

    if len(X) < 50:
        print(
            f"Só {len(X)} leituras disponíveis (mínimo recomendado: 50) — pouco pra treinar. "
            "Use --synthetic pra testar o pipeline, ou espere mais telemetria real acumular."
        )
        return

    model, metrics = train(X, y)
    print(f"MAE do modelo: {metrics['mae']:.4f} · MAE do baseline ingênuo (média): {metrics['naive_baseline_mae']:.4f}")

    if metrics["mae"] >= metrics["naive_baseline_mae"]:
        print(
            "Modelo não venceu nem o baseline ingênuo — não salvando artefato "
            "(ARCHITECTURE.md §7.1: modelo que não vence o baseline não é promovido)."
        )
        return

    MODELS_DIR.mkdir(exist_ok=True)
    artifact_path = MODELS_DIR / f"{SHADOW_MODEL_VERSION}.joblib"
    joblib.dump(model, artifact_path)
    (MODELS_DIR / f"{SHADOW_MODEL_VERSION}.json").write_text(
        json.dumps(
            {
                "model_version": SHADOW_MODEL_VERSION,
                "trained_at": datetime.now(UTC).isoformat(),
                "metrics": metrics,
                "source": source,
            },
            indent=2,
        )
    )
    print(
        f"Artefato salvo em {artifact_path} — o motor (app/pricing/engine.py) carrega isso em "
        "SHADOW automaticamente (loga a previsão, não decide o preço). Promoção é manual."
    )


if __name__ == "__main__":
    main()
