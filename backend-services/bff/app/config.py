from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    ORDER_SERVICE_URL:   str = "http://localhost:8001"
    INVOICE_SERVICE_URL: str = "http://localhost:8002"
    ENV:                 str = "local"

    class Config:
        env_file = ".env"

settings = Settings()
