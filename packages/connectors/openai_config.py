from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


@dataclass
class OpenAiRuntimeConfig:
    api_key: str
    model_id: str = "gpt-4o-mini"
    base_url: str = "https://api.openai.com/v1"
    max_tokens: int = 600
    temperature: float = 1.0
    top_p: float = 0.75
    frequency_penalty: float = 0.0
    connect_timeout_seconds: int = 10
    read_timeout_seconds: int = 240

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> OpenAiRuntimeConfig:
        source = dict(os.environ if env is None else env)
        api_key = source.get("OPENAI_API_KEY", "").strip()
        if not api_key:
            raise ValueError("missing required environment variable: OPENAI_API_KEY")

        model_id = source.get("OPENAI_MODEL_ID", source.get("OPENAI_MODEL", "gpt-4o-mini")).strip()
        if not model_id:
            model_id = "gpt-4o-mini"

        return cls(
            api_key=api_key,
            model_id=model_id,
            base_url=source.get("OPENAI_BASE_URL", "https://api.openai.com/v1"),
            max_tokens=int(source.get("OPENAI_MAX_TOKENS", "600")),
            temperature=float(source.get("OPENAI_TEMPERATURE", "1")),
            top_p=float(source.get("OPENAI_TOP_P", "0.75")),
            frequency_penalty=float(source.get("OPENAI_FREQUENCY_PENALTY", "0")),
            connect_timeout_seconds=int(source.get("OPENAI_CONNECT_TIMEOUT_SECONDS", "10")),
            read_timeout_seconds=int(source.get("OPENAI_READ_TIMEOUT_SECONDS", "240")),
        )

    @property
    def normalized_base_url(self) -> str:
        return self.base_url.rstrip("/")
