#!/usr/bin/env python3
"""
ocr.py — OCR / image recognition that works without any API key.

Use this when the surrounding chat model can't see images (mimo-v2.5-pro,
mimo-v2.5-pro[1m], mimo-v2-flash, deepseek-*, or any text-only model).

Engines (--engine):
  auto          (default) — mimo if MIMO_API_KEY set, else pollinations
  mimo          — Xiaomi MiMo V2.5 vision. Highest quality. Needs MIMO_API_KEY
  pollinations  — pollinations.ai free public vision endpoint. NO KEY REQUIRED

Modes (--mode):
  text       (default) verbatim OCR — raw text, preserves line breaks
  describe   2-4 sentence description of the image
  structured single JSON object with text / language / regions / summary
  markdown   re-render the image as GitHub-flavored Markdown

Image inputs (positional, 0+):
  /path/to/file.png          local file → base64 data URL
  https://example.com/x.png  http(s) URL → forwarded as-is
  data:image/...;base64,...  data URL → forwarded as-is
  -                          read one image from stdin (bytes)
  (none, stdin not a TTY)    same as `-`

Usage:
    # Zero-setup: free fallback, works for DeepSeek-only / no-key users
    python3 ocr.py path/to/image.png
    python3 ocr.py --mode describe https://example.com/x.png

    # Best quality (needs MiMo key)
    export MIMO_API_KEY=sk-xxxx
    python3 ocr.py --mode structured a.png b.jpg
    cat scan.png | python3 ocr.py --mode markdown

Only depends on the standard library — no `openai` SDK install needed.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


# --- modes ------------------------------------------------------------------

MODE_PROMPTS: dict[str, str] = {
    "text": (
        "Extract ALL legible text from the attached image(s) verbatim, "
        "preserving line breaks, reading order, and any obvious column/table "
        "layout using whitespace and pipes. Do not paraphrase, translate, "
        "summarize, or add commentary. If you cannot read part of it, output "
        "`[unreadable]` in place. If the image contains no text, output "
        "exactly the single line `[no text detected]`."
    ),
    "describe": (
        "Describe the contents of the attached image(s) in 2-4 sentences. "
        "Mention layout, key visual elements, any visible text (quoted), and "
        "notable colors. Do not invent details that aren't visible."
    ),
    "structured": (
        "Return ONE JSON object with keys `text` (string, full OCR — same "
        "rules as verbatim text extraction, preserve line breaks and reading "
        "order), `language` (BCP-47 best-guess like \"zh-Hans\" or \"en\"), "
        "`regions` (array of `{label, text, role}` where role is one of "
        "`title`, `paragraph`, `list`, `table`, `caption`, `ui`, "
        "`handwriting`, `other`), and `summary` (1-sentence description). "
        "Output ONLY the JSON, no markdown fences, no preamble."
    ),
    "markdown": (
        "Re-render the attached image(s) as GitHub-flavored Markdown. "
        "Headings become `#`/`##`, tables become pipe tables, code-like text "
        "becomes fenced code blocks, lists become `-`. Preserve reading "
        "order. Output ONLY the markdown body — no preamble, no fences "
        "wrapping the whole thing."
    ),
}

STRUCTURED_SYSTEM = (
    "You are an OCR engine. Output strictly machine-parseable JSON, "
    "no markdown fences, no commentary."
)


# --- MIME sniffing ----------------------------------------------------------

_MAGIC = [
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"BM", "image/bmp"),
]


def sniff_mime(data: bytes, hint_name: str | None = None) -> str:
    for sig, mime in _MAGIC:
        if data.startswith(sig):
            return mime
    # WebP: "RIFF....WEBP"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if hint_name:
        guessed, _ = mimetypes.guess_type(hint_name)
        if guessed and guessed.startswith("image/"):
            return guessed
    return "image/png"


def bytes_to_data_url(data: bytes, hint_name: str | None = None) -> str:
    mime = sniff_mime(data, hint_name)
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"


def resolve_image_arg(arg: str) -> str:
    """Turn a positional IMAGE arg into a URL suitable for image_url."""
    if arg == "-":
        if sys.stdin.isatty():
            sys.stderr.write("error: `-` requested but stdin is a TTY\n")
            sys.exit(2)
        data = sys.stdin.buffer.read()
        if not data:
            sys.stderr.write("error: stdin was empty\n")
            sys.exit(2)
        return bytes_to_data_url(data)
    if arg.startswith(("http://", "https://", "data:")):
        return arg
    path = Path(arg)
    if not path.exists():
        sys.stderr.write(f"error: image not found: {arg}\n")
        sys.exit(4)
    try:
        data = path.read_bytes()
    except OSError as e:
        sys.stderr.write(f"error: cannot read {arg}: {e}\n")
        sys.exit(4)
    return bytes_to_data_url(data, hint_name=path.name)


# --- model auto-select ------------------------------------------------------

def model_supports_images(model: str) -> bool:
    """Mirror src/translate/reqToChat.ts:modelSupportsImages."""
    base = model.split("[", 1)[0].lower()
    if "omni" in base:
        return True
    if base == "mimo-v2.5":
        return True
    return False


def pick_model(cli_model: str | None) -> tuple[str, str | None]:
    """Returns (chosen_model, note_for_stderr_or_None)."""
    if cli_model:
        if model_supports_images(cli_model):
            return cli_model, None
        return "mimo-v2.5", (
            f"note: model '{cli_model}' does not see images; "
            f"switching to mimo-v2.5 for this call.\n"
        )
    env_ocr = os.environ.get("MIMO_OCR_MODEL")
    if env_ocr and model_supports_images(env_ocr):
        return env_ocr, None
    env_chat = os.environ.get("MIMO_MODEL")
    if env_chat and model_supports_images(env_chat):
        return env_chat, None
    return "mimo-v2.5", None


# --- message building -------------------------------------------------------

def build_messages(
    *, mode: str, image_urls: list[str], lang: str | None, extra_prompt: str | None
) -> list[dict[str, Any]]:
    user_text = MODE_PROMPTS[mode]
    if lang:
        user_text += f" Primary language: {lang}."
    if extra_prompt:
        user_text += f" {extra_prompt}"

    content: list[dict[str, Any]] = [
        {"type": "image_url", "image_url": {"url": u}} for u in image_urls
    ]
    content.append({"type": "text", "text": user_text})

    messages: list[dict[str, Any]] = []
    if mode == "structured":
        messages.append({"role": "system", "content": STRUCTURED_SYSTEM})
    messages.append({"role": "user", "content": content})
    return messages


# --- HTTP -------------------------------------------------------------------

POLLINATIONS_URL = "https://text.pollinations.ai/openai"
POLLINATIONS_DEFAULT_MODEL = "openai"  # vision-capable, free, no key


def post(url: str, body: dict[str, Any], api_key: str | None, stream: bool, *, engine: str) -> Any:
    headers = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream" if stream else "application/json",
        "User-Agent": "mimoskill-ocr/0.1",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(
        url,
        method="POST",
        data=json.dumps(body).encode("utf-8"),
        headers=headers,
    )
    try:
        return urllib.request.urlopen(req, timeout=300)
    except urllib.error.HTTPError as e:
        snippet = e.read().decode("utf-8", "replace")
        sys.stderr.write(f"{engine} returned HTTP {e.code}: {snippet}\n")
        sys.exit(1)
    except urllib.error.URLError as e:
        sys.stderr.write(f"connection failed ({engine}): {e}\n")
        sys.exit(1)


def stream_chat(resp: Any) -> tuple[str, str]:
    """Stream SSE chunks; returns (full_content, full_reasoning)."""
    buf_content: list[str] = []
    buf_reasoning: list[str] = []
    for raw in resp:
        line = raw.decode("utf-8", "replace").strip()
        if not line.startswith("data:"):
            continue
        data = line[5:].strip()
        if data == "[DONE]":
            break
        try:
            chunk = json.loads(data)
        except json.JSONDecodeError:
            continue
        choice = chunk.get("choices", [{}])[0]
        delta = choice.get("delta", {})
        if r := delta.get("reasoning_content"):
            buf_reasoning.append(r)
            sys.stderr.write(r)
            sys.stderr.flush()
        if c := delta.get("content"):
            buf_content.append(c)
            sys.stdout.write(c)
            sys.stdout.flush()
    sys.stdout.write("\n")
    return "".join(buf_content), "".join(buf_reasoning)


def non_stream_chat(resp: Any) -> tuple[str, str, dict[str, Any]]:
    """Returns (content, reasoning_content, usage)."""
    payload = json.loads(resp.read().decode("utf-8"))
    msg = payload["choices"][0]["message"]
    return (
        msg.get("content") or "",
        msg.get("reasoning_content") or "",
        payload.get("usage") or {},
    )


# --- CLI --------------------------------------------------------------------

def main() -> None:
    p = argparse.ArgumentParser(
        description=__doc__.split("\n", 1)[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument(
        "images",
        nargs="*",
        metavar="IMAGE",
        help="image: local path, http(s) URL, data: URL, or `-` for stdin",
    )
    p.add_argument(
        "--mode",
        choices=list(MODE_PROMPTS),
        default="text",
        help="output mode (default: text)",
    )
    p.add_argument(
        "--model",
        default=None,
        help="MiMo vision model (default: $MIMO_OCR_MODEL / $MIMO_MODEL if "
        "vision-capable / mimo-v2.5). Non-vision models are auto-switched.",
    )
    p.add_argument(
        "--lang",
        default=None,
        help="primary language hint, e.g. 'Chinese', 'zh', '日本語'",
    )
    p.add_argument("--max-tokens", type=int, default=4096)
    p.add_argument("--temperature", type=float, default=0.2)
    p.add_argument(
        "--engine",
        choices=["auto", "mimo", "pollinations"],
        default=os.environ.get("MIMO_OCR_ENGINE", "auto"),
        help="OCR backend. auto = mimo if MIMO_API_KEY set, else pollinations "
        "(free, no key required). default: %(default)s",
    )
    p.add_argument(
        "--base-url",
        default=os.environ.get("MIMO_BASE_URL", "https://api.xiaomimimo.com/v1"),
        help="MiMo OpenAI-compat endpoint, ignored when --engine=pollinations "
        "(default: %(default)s)",
    )
    p.add_argument(
        "--pollinations-model",
        default=os.environ.get("POLLINATIONS_MODEL", POLLINATIONS_DEFAULT_MODEL),
        help="model id when --engine=pollinations (default: %(default)s)",
    )
    p.add_argument(
        "--prompt",
        default=None,
        help="extra instruction appended to the mode prompt",
    )
    p.add_argument("--json", action="store_true", help="wrap stdout as JSON envelope")
    p.add_argument("--stream", action="store_true", help="stream the response")
    args = p.parse_args()

    api_key = os.environ.get("MIMO_API_KEY")

    # Resolve engine.
    if args.engine == "mimo":
        engine = "mimo"
        if not api_key:
            sys.stderr.write(
                "error: --engine mimo requires MIMO_API_KEY.\n"
                "  set one at https://platform.xiaomimimo.com/#/console/api-keys\n"
                "  OR drop the flag to fall back to pollinations (free, no key required):\n"
                "      python3 ocr.py <image>\n"
            )
            sys.exit(3)
    elif args.engine == "pollinations":
        engine = "pollinations"
    else:  # auto
        engine = "mimo" if api_key else "pollinations"
        if engine == "pollinations":
            sys.stderr.write(
                "[engine] auto -> pollinations (free, no key). "
                "Set MIMO_API_KEY for higher quality (mimo-v2.5).\n"
            )

    # Resolve images: explicit args, else stdin if not a TTY.
    raw_args = args.images
    if not raw_args and not sys.stdin.isatty():
        raw_args = ["-"]
    if not raw_args:
        sys.stderr.write(
            "error: no image given. Pass one or more IMAGE args or pipe bytes "
            "on stdin. See `ocr.py --help`.\n"
        )
        sys.exit(2)

    image_urls = [resolve_image_arg(a) for a in raw_args]

    if engine == "mimo":
        model, note = pick_model(args.model)
        if note:
            sys.stderr.write(note)
    else:
        if args.model:
            sys.stderr.write(
                f"note: --model is mimo-specific; ignoring on pollinations "
                f"(use --pollinations-model instead).\n"
            )
        model = args.pollinations_model

    sys.stderr.write(
        f"[ocr] engine={engine} mode={args.mode} model={model} images={len(image_urls)}\n"
    )

    messages = build_messages(
        mode=args.mode,
        image_urls=image_urls,
        lang=args.lang,
        extra_prompt=args.prompt,
    )

    body: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": args.temperature,
        "stream": args.stream,
    }
    if engine == "mimo":
        # MiMo's quirk: max_completion_tokens, not max_tokens.
        body["max_completion_tokens"] = args.max_tokens
        url = args.base_url.rstrip("/") + "/chat/completions"
        auth = api_key
    else:
        body["max_tokens"] = args.max_tokens
        url = POLLINATIONS_URL
        auth = None

    resp = post(url, body, auth, args.stream, engine=engine)

    if args.stream:
        content, reasoning = stream_chat(resp)
        usage: dict[str, Any] = {}
    else:
        content, reasoning, usage = non_stream_chat(resp)
        if reasoning:
            sys.stderr.write(f"[reasoning]\n{reasoning}\n[/reasoning]\n\n")
        if args.json:
            envelope = {
                "mode": args.mode,
                "model": model,
                "images": len(image_urls),
                "content": content,
                "reasoning_content": reasoning,
                "usage": usage,
            }
            print(json.dumps(envelope, ensure_ascii=False, indent=2))
        else:
            print(content)
        return

    # Streaming + --json: emit envelope after the streamed body.
    if args.json:
        envelope = {
            "mode": args.mode,
            "model": model,
            "images": len(image_urls),
            "content": content,
            "reasoning_content": reasoning,
            "usage": {},
        }
        sys.stdout.write("\n---\n")
        sys.stdout.write(json.dumps(envelope, ensure_ascii=False, indent=2))
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
