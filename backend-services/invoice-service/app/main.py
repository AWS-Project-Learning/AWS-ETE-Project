from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .database import engine, Base
from .routes import invoices
from .events import start_listener

Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start Redis listener in background thread on startup
    start_listener()
    yield
    # Shutdown — listener thread is daemon so exits automatically


app = FastAPI(
    title="Invoice Service",
    description="Handles invoice generation, retrieval, and payment status. Listens to order events via Redis.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(invoices.router)


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "invoice-service"}
