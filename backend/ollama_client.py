import os

import requests

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
MODEL = os.getenv("OLLAMA_MODEL", "qwen3:14b")
MODEL_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS", "180"))


class OllamaUnavailableError(RuntimeError):
    pass


class OllamaModelError(RuntimeError):
    pass


class OllamaTimeoutError(RuntimeError):
    pass


def ask_model(prompt: str, json_mode: bool = False) -> str:
    payload = {"model": MODEL, "prompt": prompt, "stream": False}
    if json_mode:
        payload["format"] = "json"
    try:
        response = requests.post(
            OLLAMA_URL,
            json=payload,
            timeout=MODEL_TIMEOUT_SECONDS,
        )
    except requests.Timeout as exc:
        raise OllamaTimeoutError("The local model timed out.") from exc
    except requests.ConnectionError as exc:
        raise OllamaUnavailableError("Ollama is not reachable on this device.") from exc

    if response.status_code == 404:
        raise OllamaModelError(f"The configured local model '{MODEL}' is unavailable.")
    try:
        response.raise_for_status()
    except requests.RequestException as exc:
        raise OllamaUnavailableError("Ollama could not complete the request.") from exc

    try:
        data = response.json()
        return data["response"]
    except (ValueError, KeyError, TypeError) as exc:
        raise OllamaModelError("Ollama returned an unexpected response.") from exc
