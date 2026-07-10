"""LLM bridge with two modes:

1. API mode  — ANTHROPIC_API_KEY set: calls the Anthropic Messages API directly.
2. Manual mode — no key (or SHORTS_MANUAL=1): writes the fully-filled prompt to
   work/llm/<stage>.prompt.md, tells you to paste it into ANY chat LLM
   (claude.ai, or anything else that can follow instructions), and to save the
   JSON reply to work/llm/<stage>.response.txt. Re-run the stage and it picks
   the response up.

Manual mode is the durability guarantee: the prompts are plain markdown and the
contracts are plain JSON, so the pipeline outlives any particular API or vendor.
"""
import json
import os
import re
import sys
from pathlib import Path


class ManualModeExit(SystemExit):
    pass


def fill(template: str, variables: dict) -> str:
    out = template
    for k, v in variables.items():
        out = out.replace("{{" + k + "}}", str(v))
    leftover = re.findall(r"\{\{(\w+)\}\}", out)
    if leftover:
        raise ValueError(f"Unfilled prompt variables: {leftover}")
    return out


def extract_json(text: str):
    """Tolerant JSON extraction: fenced block first, then outermost braces/brackets."""
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    text = text.strip()
    for opener, closer in (("{", "}"), ("[", "]")):
        i, j = text.find(opener), text.rfind(closer)
        if i != -1 and j > i:
            try:
                return json.loads(text[i:j + 1])
            except json.JSONDecodeError:
                continue
    return json.loads(text)  # last resort; raises with a useful message


def call(stage: str, prompt_file: str, variables: dict, project_paths: dict,
         settings: dict, temperature: float | None = None):
    """Run one LLM stage. Returns parsed JSON."""
    from . import util
    template = (util.ROOT / "prompts" / prompt_file).read_text()
    prompt = fill(template, variables)

    llm_dir = project_paths["llm"]
    prompt_path = llm_dir / f"{stage}.prompt.md"
    response_path = llm_dir / f"{stage}.response.txt"

    # Cache is keyed to prompt content: if the prompt changed (new feedback,
    # shifted window, edited style guide), any old response is invalid.
    old_prompt = prompt_path.read_text() if prompt_path.exists() else None
    if old_prompt != prompt and response_path.exists():
        response_path.unlink()
    prompt_path.write_text(prompt)

    manual = os.environ.get("SHORTS_MANUAL") == "1" or not os.environ.get("ANTHROPIC_API_KEY")

    if response_path.exists():
        text = response_path.read_text()
    elif manual:
        print("\n" + "=" * 62)
        print(f"MANUAL LLM MODE — stage '{stage}'")
        print(f"1. Open:   {prompt_path}")
        print("2. Paste its full contents into any capable chat LLM.")
        print(f"3. Save the model's raw JSON reply to:\n           {response_path}")
        print("4. Re-run this same command.")
        print("=" * 62 + "\n")
        raise ManualModeExit(3)
    else:
        text = _api_call(prompt, settings, temperature)
        response_path.write_text(text)

    try:
        return extract_json(text)
    except Exception as e:
        sys.exit(
            f"Could not parse JSON from the {stage} response "
            f"(saved at {response_path}). Fix the file by hand so it contains "
            f"only valid JSON, then re-run. Parser said: {e}"
        )


def _api_call(prompt: str, settings: dict, temperature: float | None) -> str:
    import anthropic  # lazy import so manual mode works without the package
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model=settings["model"],
        max_tokens=4096,
        temperature=settings["temperature"] if temperature is None else temperature,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")


def clear_response(project_paths: dict, stage: str):
    """Force a stage to re-ask the LLM (used by --force and the revise loop)."""
    f = project_paths["llm"] / f"{stage}.response.txt"
    if f.exists():
        f.unlink()
