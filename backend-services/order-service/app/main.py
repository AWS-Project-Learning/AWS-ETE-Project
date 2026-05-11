from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .database import engine, Base
from .routes import orders

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Order Service",
    description="Handles order creation, retrieval, and status management.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(orders.router)


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "order-service"}
