"""Entry point for ``shirube`` / ``uvx shirube``.

Starts the local API server (which also serves the bundled single-page app in a
packaged build) and, unless disabled, opens the browser once the server is up.
"""

import threading
import webbrowser

import uvicorn

from shirube.config import get_settings


def _open_browser(url: str) -> None:
    """Open ``url`` in the user's default browser (best effort)."""
    webbrowser.open(url)


def main() -> None:
    """Launch the shirube server and open the browser.

    Binds to the configured host and port (loopback by default) and blocks while
    uvicorn runs. The browser launch is deferred by a short timer so it fires just
    after the server starts accepting connections rather than before.
    """
    settings = get_settings()
    url = f"http://{settings.host}:{settings.port}"
    if settings.open_browser:
        # Defer the launch slightly so the server is ready to answer the first request.
        threading.Timer(1.0, _open_browser, args=[url]).start()
    uvicorn.run(
        "shirube.adapters.api.app:app",
        host=settings.host,
        port=settings.port,
    )


if __name__ == "__main__":
    main()
