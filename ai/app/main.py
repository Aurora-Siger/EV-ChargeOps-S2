from fastapi import FastAPI

from app.api.routes import router

app = FastAPI(title="EVChargeOps AI", docs_url=None, redoc_url=None)  # sem docs públicas
app.include_router(router)


@app.get("/healthz")
def healthz() -> str:
    return "ok"
