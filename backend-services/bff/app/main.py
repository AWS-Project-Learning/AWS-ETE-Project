import logging
import importlib.metadata as importlib_metadata
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .client import order_client, invoice_client
from .routes import orders, invoices, dashboard
from .config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def _pkg_ver(name: str) -> str:
    try:
        return importlib_metadata.version(name)
    except Exception:
        return "not_installed"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting BFF...")
    logger.info(f"RUNTIME_DEP_VERSION python-dotenv={_pkg_ver('python-dotenv')}")
    logger.info(f"RUNTIME_DEP_VERSION cryptography={_pkg_ver('cryptography')}")
    logger.info(f"ORDER_SERVICE_URL  = {settings.ORDER_SERVICE_URL}")
    logger.info(f"INVOICE_SERVICE_URL = {settings.INVOICE_SERVICE_URL}")
    logger.info(f"CORS_ORIGINS        = {settings.CORS_ORIGINS}")
    yield
    logger.info("BFF shutting down — closing HTTP clients.")
    await order_client.aclose()
    await invoice_client.aclose()


app = FastAPI(
    title="BFF — Backend for Frontend",
    description="Single entry point for the React frontend. Aggregates Order Service and Invoice Service.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(orders.router)
app.include_router(invoices.router)
app.include_router(dashboard.router)


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "bff"}
