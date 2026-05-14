import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .database import engine, Base, SessionLocal
from .routes import invoices
from .events import start_listener

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting invoice-service...")
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created/verified.")
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        logger.info("Database connection OK.")
    except Exception as e:
        logger.error(f"Database connection FAILED: {e}")
        raise
    start_listener()
    logger.info("Redis listener started (fails silently if Redis unavailable).")
    yield
    logger.info("invoice-service shutting down.")


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
