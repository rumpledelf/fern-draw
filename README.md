# Phrond Draw

Phrond Draw is the web-based SVG editor in the Phrond creative tools suite.
This public repository contains the editor application that is mounted and
served by the `fern-landing` product shell at `/tools/draw/`.

## Development

> **Note**: `fern-draw` cannot be run freestanding or individually. It is mounted directly into and served by the `fern-landing` product shell at `/tools/draw/`.

To run the application locally, start the `fern-landing` development server:

```bash
cd ../fern-landing
php artisan serve
```

## Draft And Account Precedence

Draw's persistence must be audited against the account boundary used by
Publish. Browser drafts are only for work created by a genuinely anonymous user
who has never used an account in that browser profile. Once the user has logged
in, Draw must use account assets rather than maintaining a competing browser
copy. If authentication expires, keep unsaved changes in the current tab and
ask the user to log in; do not silently switch the drawing to browser storage.

When opening an account drawing with an `asset` URL, the account copy is
authoritative. Any different legacy local copy must not be merged or silently
restored. Tell the user before discarding it, then remove the stale local copy.
This is a required persistence rule, not confirmation that every Draw path has
already been verified.

Then access Draw at `http://127.0.0.1:8000/tools/draw/`.

## Selection tools

Draw separates navigation from selection:

- **Hand (H)** pans the canvas without changing the current selection.
- **Select shape or nodes (A)** selects individual shapes and exposes their editable nodes.
- **Select group (G)** selects the nearest containing SVG group.
- **Marquee select (V)** selects shapes whose complete bounds are contained by the dragged box. Hold Shift to add or remove shapes from the selection.

Press the arrow keys to nudge selected shapes or nodes by one screen pixel. Hold Shift while nudging to move by ten screen pixels. Hold Space to pan temporarily while using another tool.

### Tests

Run unit tests with:

```bash
python3 -m unittest discover -s tests -v
```
