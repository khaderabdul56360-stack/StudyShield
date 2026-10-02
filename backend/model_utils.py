import json
import re
from typing import Callable, TypeVar

from pydantic import BaseModel, ValidationError


T = TypeVar("T", bound=BaseModel)


class StructuredOutputError(ValueError):
    pass


def _json_text(raw: str) -> str:
    text = raw.strip()
    fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE)
    return fenced.group(1) if fenced else text


def parse_structured(raw: str, schema: type[T]) -> T:
    try:
        return schema.model_validate(json.loads(_json_text(raw)))
    except (json.JSONDecodeError, ValidationError, TypeError) as exc:
        raise StructuredOutputError(str(exc)) from exc


def ask_structured(prompt: str, schema: type[T], ask: Callable[[str], str]) -> T:
    raw = ask(prompt)
    try:
        return parse_structured(raw, schema)
    except StructuredOutputError as first_error:
        repair_prompt = f"""Your prior response failed JSON validation.
Return ONLY one valid JSON object. No markdown or commentary.
Required JSON schema:
{json.dumps(schema.model_json_schema(), indent=2)}

Invalid response:
{raw}

Validation problem:
{first_error}
"""
        repaired = ask(repair_prompt)
        try:
            return parse_structured(repaired, schema)
        except StructuredOutputError as second_error:
            raise StructuredOutputError("The local model returned invalid structured output twice.") from second_error

