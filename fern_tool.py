"""Django integration module for the Fern Draw tool.

Draw is a pure client-side SVG editor with no server-side API endpoints.
All routing (index page and static file serving) is handled by the
generic tool mounting system in fern-landing.
"""

from pathlib import Path

TOOL_ROOT = Path(__file__).resolve().parent

# Draw has no API endpoints; the mounting system serves index.html and
# static files from TOOL_ROOT automatically.
urlpatterns = []
