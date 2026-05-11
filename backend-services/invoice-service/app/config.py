from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL:      str = "sqlite:///./invoicedb.sqlite"
    REDIS_URL:         str = "redis://localhost:6379"
    ORDER_SERVICE_URL: str = "http://localhost:8001"
    ENV:               str = "local"

    class Config:
        env_file = ".env"

settings = Settings()
