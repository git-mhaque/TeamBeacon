from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Mapping


@dataclass
class OllamaRuntimeConfig:
    model_id: str
    base_url: str = "http://127.0.0.1:11434"
    num_ctx: int = 8192
    max_tokens: int = 600
    temperature: float = 1.0
    top_p: float = 0.75
    top_k: int = 0
    repeat_penalty: float = 1.0
    connect_timeout_seconds: int = 10
    read_timeout_seconds: int = 240

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> OllamaRuntimeConfig:
        source = dict(os.environ if env is None else env)
        model_id = source.get("OLLAMA_MODEL_ID", source.get("OLLAMA_MODEL", "")).strip()
        if not model_id:
            raise ValueError("missing required environment variable: OLLAMA_MODEL (or OLLAMA_MODEL_ID)")

        return cls(
            model_id=model_id,
            base_url=source.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434"),
            num_ctx=int(source.get("OLLAMA_NUM_CTX", "8192")),
            max_tokens=int(source.get("OLLAMA_MAX_TOKENS", "600")),
            temperature=float(source.get("OLLAMA_TEMPERATURE", "1")),
            top_p=float(source.get("OLLAMA_TOP_P", "0.75")),
            top_k=int(source.get("OLLAMA_TOP_K", "0")),
            repeat_penalty=float(source.get("OLLAMA_REPEAT_PENALTY", "1")),
            connect_timeout_seconds=int(source.get("OLLAMA_CONNECT_TIMEOUT_SECONDS", "10")),
            read_timeout_seconds=int(source.get("OLLAMA_READ_TIMEOUT_SECONDS", "240")),
        )

    @property
    def normalized_base_url(self) -> str:
        return self.base_url.rstrip("/")
