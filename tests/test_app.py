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

    def test_non_get_requests_are_rejected(self) -> None:
        fern_status, _, _ = fern_request("/", "POST")
        self.assertEqual(fern_status, "405 Method Not Allowed")

    def test_static_path_cannot_escape_its_root(self) -> None:
        fern_status, _, _ = fern_request("/static/../app.py")
        self.assertEqual(fern_status, "404 Not Found")


if __name__ == "__main__":
    unittest.main()
