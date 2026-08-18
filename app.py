"""Freestanding static server for the Fern Draw browser editor."""

from __future__ import annotations

import json
import mimetypes
import os
from pathlib import Path
from typing import Any, Callable
from wsgiref.simple_server import make_server


FERN_DRAW_ROOT = Path(__file__).resolve().parent
FERN_DRAW_STATIC_DIR = FERN_DRAW_ROOT / "static"
FERN_DRAW_STYLES_DIR = FERN_DRAW_ROOT / "styles"
FERN_SHARED_STYLES_DIR = FERN_DRAW_ROOT.parent / "fern-landing" / "styles"


def fern_response(
    fern_body: bytes,
    fern_content_type: str,
    fern_status: str = "200 OK",
) -> tuple[str, list[tuple[str, str]], list[bytes]]:
    return fern_status, [
        ("Content-Type", fern_content_type),
        ("Content-Length", str(len(fern_body))),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
    ], [fern_body]


def fern_json_response(
    fern_payload: dict[str, Any], fern_status: str = "200 OK"
) -> tuple[str, list[tuple[str, str]], list[bytes]]:
    return fern_response(
        json.dumps(fern_payload, separators=(",", ":")).encode("utf-8"),
        "application/json; charset=utf-8",
        fern_status,
    )


def fern_safe_file_response(
    fern_root: Path,
    fern_relative_name: str,
) -> tuple[str, list[tuple[str, str]], list[bytes]]:
    try:
        fern_resolved_root = fern_root.resolve()
        fern_path = (fern_resolved_root / fern_relative_name).resolve()
        if not fern_path.is_relative_to(fern_resolved_root) or not fern_path.is_file():
            raise ValueError
        fern_body = fern_path.read_bytes()
    except (OSError, ValueError):
        return fern_response(b"Not found.\n", "text/plain; charset=utf-8", "404 Not Found")
    fern_content_type = mimetypes.guess_type(fern_path.name)[0] or "application/octet-stream"
    if fern_content_type.startswith("text/") or "javascript" in fern_content_type:
        fern_content_type = f"{fern_content_type}; charset=utf-8"
    return fern_response(fern_body, fern_content_type)


def fern_create_application() -> Callable[[dict[str, Any], Callable[..., Any]], list[bytes]]:
    def fern_application(
        fern_environ: dict[str, Any], fern_start_response: Callable[..., Any]
    ) -> list[bytes]:
        fern_path = fern_environ.get("PATH_INFO", "/")
        fern_method = fern_environ.get("REQUEST_METHOD", "GET").upper()
        if fern_method != "GET":
            fern_result = fern_response(
                b"Method not allowed.\n",
                "text/plain; charset=utf-8",
                "405 Method Not Allowed",
            )
        elif fern_path == "/":
            fern_result = fern_safe_file_response(FERN_DRAW_ROOT, "index.html")
        elif fern_path == "/health":
            fern_result = fern_json_response({"ok": True, "service": "fern-draw"})
        elif fern_path.startswith("/static/"):
            fern_result = fern_safe_file_response(
                FERN_DRAW_STATIC_DIR, fern_path.removeprefix("/static/")
            )
        elif fern_path.startswith("/styles/"):
            fern_style_name = fern_path.removeprefix("/styles/")
            if fern_style_name == "MaterialIcons-Regular.woff2":
                fern_result = fern_safe_file_response(
                    FERN_SHARED_STYLES_DIR / "assets", fern_style_name
                )
            else:
                fern_result = fern_safe_file_response(FERN_DRAW_STYLES_DIR, fern_style_name)
        else:
            fern_result = fern_response(
                b"Not found.\n", "text/plain; charset=utf-8", "404 Not Found"
            )
        fern_status, fern_headers, fern_body = fern_result
        fern_start_response(fern_status, fern_headers)
        return fern_body

    return fern_application


def fern_main() -> None:
    fern_host = os.environ.get("FERN_DRAW_HOST", "127.0.0.1")
    if fern_host not in {"127.0.0.1", "localhost", "::1"}:
        raise SystemExit("The Fern Draw server only accepts a loopback host.")
    fern_port = int(os.environ.get("FERN_DRAW_PORT", "8010"))
    try:
        with make_server(fern_host, fern_port, fern_create_application()) as fern_server:
            print(f"Fern Draw listening on http://{fern_host}:{fern_port}")
            fern_server.serve_forever()
    except KeyboardInterrupt:
        print("\nFern Draw stopped.")


if __name__ == "__main__":
    fern_main()
