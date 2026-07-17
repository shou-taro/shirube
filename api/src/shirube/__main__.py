"""Entry point for ``shirube`` / ``uvx shirube``.

Starts the local API server (which also serves the bundled single-page app in a
packaged build) and, unless disabled, opens the browser once the server is up.
"""

import threading
import webbrowser

import uvicorn

from shirube import __version__
from shirube.config import get_settings
from shirube.logging_config import setup_logging


def _is_loopback(host: str) -> bool:
    """Whether ``host`` refers to the local machine only (not the network)."""
    return host in {"localhost", "::1", "[::1]"} or host.startswith("127.")


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
    logger = setup_logging()
    logger.info(
        "shirube %s starting on http://%s:%s (data: %s)",
        __version__,
        settings.host,
        settings.port,
        settings.data_dir,
    )
    if not _is_loopback(settings.host):
        # shirube is single-user and unauthenticated by design; binding beyond loopback
        # exposes an unprotected API on the network, so make an accidental one loud.
        logger.warning(
            "shirube is bound to %s, which is not a loopback address — it may be "
            "reachable from your network. shirube is single-user and unauthenticated; "
            "bind to 127.0.0.1 unless you intend to expose it.",
            settings.host,
        )
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
