from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from .client import order_client, invoice_client
from .routes import orders, invoices, dashboard


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    # Close HTTP clients gracefully on shutdown
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
    allow_origins=["http://localhost:5173"],  # React dev server
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(orders.router)
app.include_router(invoices.router)
app.include_router(dashboard.router)


@app.get("/health", tags=["Health"])
def health():
    return {"status": "ok", "service": "bff"}
