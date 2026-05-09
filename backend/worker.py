"""Whisper worker subprocess.

Reads a single JSON config line from stdin, emits NDJSON events on stdout.
The parent controls lifecycle via signals: SIGSTOP/SIGCONT for pause/resume,
SIGTERM for cancel. No special handling needed in this script — the OS
suspends/resumes/terminates the process directly.
"""
from __future__ import annotations

import json
import sys

from faster_whisper import WhisperModel


_LANG_PROMPTS = {
    "zh-TW": ("zh", "以下是繁體中文的句子。"),
    "zh-CN": ("zh", "以下是简体中文的句子。"),
}


def resolve_language(lang):
    if lang == "auto":
        return None, None
    if not lang:
        return _LANG_PROMPTS["zh-TW"]
    if lang in _LANG_PROMPTS:
        return _LANG_PROMPTS[lang]
    return lang, None


def emit(event):
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def main():
    config = json.loads(sys.stdin.readline())
    file_path = config["file_path"]
    language = config.get("language")
    vad = config.get("vad", True)
    beam_size = config.get("beam_size", 5)
    model_size = config.get("model", "medium")
    device = config.get("device", "cpu")
    compute = config.get("compute", "int8")

    try:
        model = WhisperModel(model_size, device=device, compute_type=compute)
        whisper_lang, initial_prompt = resolve_language(language)
        segments, info = model.transcribe(
            file_path,
            language=whisper_lang,
            beam_size=beam_size,
            vad_filter=vad,
            initial_prompt=initial_prompt,
        )
        emit({
            "type": "info",
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration,
        })
        for seg in segments:
            text = (seg.text or "").strip()
            if not text:
                continue
            emit({"type": "segment", "start": seg.start, "end": seg.end, "text": text})
        emit({"type": "done"})
    except Exception as exc:
        emit({"type": "error", "message": str(exc)})
        sys.exit(1)


if __name__ == "__main__":
    main()
