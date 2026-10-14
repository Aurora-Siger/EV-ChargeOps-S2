from datetime import timedelta, timezone

# Fuso do condomínio: UTC-3 fixo (o Brasil não tem horário de verão desde 2019), como no server.
BRT = timezone(timedelta(hours=-3))
WEEKDAYS = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
