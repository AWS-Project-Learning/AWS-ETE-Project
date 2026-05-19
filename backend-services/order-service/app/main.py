import logging
import importlib.metadata as importlib_metadata
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from .database import engine, Base, SessionLocal
from .routes import orders

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def _pkg_ver(name: str) -> str:
    try:
        return importlib_metadata.version(name)
    except Exception:
        return "not_installed"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting order-service...")
    logger.info(f"RUNTIME_DEP_VERSION python-dotenv={_pkg_ver('python-dotenv')}")
    logger.info(f"RUNTIME_DEP_VERSION cryptography={_pkg_ver('cryptography')}")
    try:
        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created/verified.")
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        logger.info("Database connection OK.")
    except Exception as e:
        logger.error(f"Database connection FAILED: {e}")
        raise
    yield
    logger.info("order-service shutting down.")


app = FastAPI(
    title="Order Service",
    description="Handles order creation, retrieval, and status management.",
    version="1.0.0",
    lifespan=lifespan,
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
