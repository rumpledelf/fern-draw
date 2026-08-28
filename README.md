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

Then access Draw at `http://127.0.0.1:8000/tools/draw/`.

### Tests

Run unit tests with:

```bash
python3 -m unittest discover -s tests -v
```
