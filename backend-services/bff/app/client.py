import httpx
from fastapi import HTTPException
from .config import settings

# Shared async HTTP clients — reused across requests (efficient, connection pooling)
order_client   = httpx.AsyncClient(base_url=settings.ORDER_SERVICE_URL,   timeout=10.0)
invoice_client = httpx.AsyncClient(base_url=settings.INVOICE_SERVICE_URL, timeout=10.0)


async def forward(client: httpx.AsyncClient, method: str, path: str, **kwargs):
    """
    Forward a request to a downstream service.
    Raises HTTPException with the downstream status code and detail if the call fails.
    """
    try:
        response = await client.request(method, path, **kwargs)
        if response.status_code >= 400:
            raise HTTPException(
                status_code=response.status_code,
                detail=response.json().get("detail", response.text),
            )
        return response.json()
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Downstream service unavailable: {e}")
