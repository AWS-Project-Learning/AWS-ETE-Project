from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    ORDER_SERVICE_URL:   str  = "http://localhost:8001"
    INVOICE_SERVICE_URL: str  = "http://localhost:8002"
    ENV:                 str  = "local"
    CORS_ORIGINS:        str  = "http://localhost:5173"

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"

settings = Settings()
