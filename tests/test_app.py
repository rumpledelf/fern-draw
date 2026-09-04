from __future__ import annotations

import io
import json
import unittest

from app import fern_create_application


def fern_request(
    fern_path: str,
    fern_method: str = "GET",
) -> tuple[str, dict[str, str], bytes]:
    fern_result: dict[str, object] = {}

    def fern_start_response(
        fern_status: str,
        fern_headers: list[tuple[str, str]],
    ) -> None:
        fern_result["status"] = fern_status
        fern_result["headers"] = dict(fern_headers)

    fern_body = b"".join(
        fern_create_application()(
            {
                "PATH_INFO": fern_path,
                "REQUEST_METHOD": fern_method,
                "wsgi.input": io.BytesIO(),
            },
            fern_start_response,
        )
    )
    return (
        str(fern_result["status"]),
        dict(fern_result["headers"]),
        fern_body,
    )


class FernDrawApplicationTests(unittest.TestCase):
    def test_root_and_health_are_available(self) -> None:
        fern_status, fern_headers, fern_body = fern_request("/")
        self.assertEqual(fern_status, "200 OK")
        self.assertIn("text/html", fern_headers["Content-Type"])
        self.assertIn(b"Phrond Draw", fern_body)

        fern_status, _, fern_body = fern_request("/health")
        self.assertEqual(fern_status, "200 OK")
        self.assertEqual(
            json.loads(fern_body),
            {"ok": True, "service": "fern-draw"},
        )

    def test_javascript_is_served(self) -> None:
        fern_status, fern_headers, fern_body = fern_request("/static/fern-draw.js")
        self.assertEqual(fern_status, "200 OK")
        self.assertIn("javascript", fern_headers["Content-Type"])
        self.assertIn(b"fern_openSvg", fern_body)
        self.assertNotIn(b"/api/drawing", fern_body)

    def test_selection_tools_have_distinct_roles(self) -> None:
        _, _, fern_html = fern_request("/")
        self.assertIn(b'data-mode="pan" title="Hand - pan canvas (H)"', fern_html)
        self.assertIn(b'data-mode="select" title="Marquee select (V)"', fern_html)
        self.assertIn(b'data-mode="select-node" title="Select shape or nodes (A)"', fern_html)
        self.assertIn(b'data-mode="select-group" title="Select group (G)"', fern_html)

        _, _, fern_javascript = fern_request("/static/fern-draw.js")
        self.assertIn(b'let fernEditorMode = "pan"', fern_javascript)
        self.assertIn(b'fernEditorMode === "select"', fern_javascript)
        self.assertIn(b"fern_elementPointToCanvas", fern_javascript)
        self.assertIn(b"fern_elementToCanvasMatrix", fern_javascript)
        self.assertIn(b"fern_formatTransformNumber", fern_javascript)
        self.assertIn(b"fern_geometryDistanceFromPointer", fern_javascript)
        self.assertIn(b"fern_getNudgeStep", fern_javascript)
        self.assertIn(b"fern_canvasDeltaToElement", fern_javascript)
        self.assertIn(b"fern_nearestSelectableGroup", fern_javascript)
        self.assertIn(b"fern_nudgeSelection", fern_javascript)
        self.assertIn(b"fern_screenPixelsToElementUnits", fern_javascript)
        self.assertIn(b"function fern_handlePointerUp(event)", fern_javascript)
        self.assertIn(b'"is-panning", "is-drawing-path", "is-zoomed"', fern_javascript)

    def test_material_icon_font_is_served(self) -> None:
        fern_status, fern_headers, fern_body = fern_request(
            "/styles/MaterialIcons-Regular.woff2"
        )
        self.assertEqual(fern_status, "200 OK")
        self.assertIn("font/woff2", fern_headers["Content-Type"])
        self.assertGreater(len(fern_body), 1_000)

    def test_non_get_requests_are_rejected(self) -> None:
        fern_status, _, _ = fern_request("/", "POST")
        self.assertEqual(fern_status, "405 Method Not Allowed")

    def test_static_path_cannot_escape_its_root(self) -> None:
        fern_status, _, _ = fern_request("/static/../app.py")
        self.assertEqual(fern_status, "404 Not Found")


if __name__ == "__main__":
    unittest.main()
