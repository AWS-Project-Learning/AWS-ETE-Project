from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./orderdb.sqlite"
    ENV: str          = "local"

    # SNS topic ARN — populated in production from SSM via the deploy pipeline.
    # When empty (local dev), events.publish() logs and skips, so the service
    # still functions without AWS access.
    ORDER_CREATED_TOPIC_ARN: str = ""

    class Config:
        env_file = ".env"

settings = Settings()
