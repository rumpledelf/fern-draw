# Phrond Draw

Phrond Draw is the web-based SVG editor in the Phrond creative tools suite.
This public repository contains the editor application that is mounted and
served by the `fern-landing` product shell at `/tools/draw/`.

## Development

The bundled server is only a local development runner:

```bash
python3 app.py
```

Then open `http://127.0.0.1:8010`.

Run the tests with:

```bash
python3 -m unittest discover -s tests -v
```
