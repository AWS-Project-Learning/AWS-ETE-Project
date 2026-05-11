from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./orderdb.sqlite"
    REDIS_URL: str    = "redis://localhost:6379"
    ENV: str          = "local"

    class Config:
        env_file = ".env"

settings = Settings()
