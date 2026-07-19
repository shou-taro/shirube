"""Entry point for ``shirube`` / ``uvx shirube``.

Starts the local API server (which also serves the bundled single-page app in a
packaged build) and, unless disabled, opens the browser once the server is up.
"""

import socket
import threading
import time
import webbrowser

import uvicorn

from shirube import __version__
from shirube.config import get_settings
from shirube.logging_config import setup_logging

# Cap how long we wait for the server before giving up on opening the browser, and how
# often we re-check. A cold start (imports, database bootstrap) can take a second or two.
BROWSER_READY_TIMEOUT_SECONDS = 30.0
BROWSER_POLL_INTERVAL_SECONDS = 0.1


def _is_loopback(host: str) -> bool:
    """Whether ``host`` refers to the local machine only (not the network)."""
    return host in {"localhost", "::1", "[::1]"} or host.startswith("127.")


def _wait_until_ready(host: str, port: int, timeout: float) -> bool:
    """Poll until the server accepts a TCP connection, or ``timeout`` elapses.

    Args:
        host: The host the server is bound to.
        port: The port the server is listening on.
        timeout: Maximum seconds to wait before giving up.

    Returns:
        True once a connection succeeds; False if the timeout is reached first.
    """
    # ``0.0.0.0`` means "all interfaces" and isn't itself connectable; probe loopback.
    # An IPv6 literal may arrive bracketed (``[::1]``) — strip it for ``connect``.
    # This is a comparison to detect the wildcard, not a bind, so B104 doesn't apply.
    connect_host = "127.0.0.1" if host == "0.0.0.0" else host.strip("[]")  # nosec B104
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((connect_host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(BROWSER_POLL_INTERVAL_SECONDS)
    return False


def _open_browser_when_ready(host: str, port: int, url: str) -> None:
    """Open ``url`` once the server is answering, so the first request never races it.

    A fixed delay is unreliable — a slow cold start opens the browser before the server
    listens, and the user sees a connection error. Waiting for the port to accept a
    connection is robust regardless of machine speed. Best effort: if the server never
    comes up within the timeout, quietly skip opening.
    """
    if _wait_until_ready(host, port, BROWSER_READY_TIMEOUT_SECONDS):
        webbrowser.open(url)


def main() -> None:
    """Launch the shirube server and open the browser.

    Binds to the configured host and port (loopback by default) and blocks while
    uvicorn runs. A background thread waits for the server to accept connections and
    then opens the browser, so the launch never races ahead of a slow start-up.
    """
    settings = get_settings()
    logger = setup_logging()
    logger.info(
        "starting",
        version=__version__,
        host=settings.host,
        port=settings.port,
        data_dir=str(settings.data_dir),
    )
    if not _is_loopback(settings.host):
        # shirube is single-user and unauthenticated by design; binding beyond loopback
        # exposes an unprotected API on the network, so make an accidental one loud.
        logger.warning(
            "bound to a non-loopback address — shirube may be reachable from your "
            "network. It is single-user and unauthenticated; bind to 127.0.0.1 unless "
            "you intend to expose it.",
            host=settings.host,
        )
    url = f"http://{settings.host}:{settings.port}"
    if settings.open_browser:
        # Open the browser only once the server is accepting connections; a daemon
        # thread so it never keeps the process alive past shutdown.
        threading.Thread(
            target=_open_browser_when_ready,
            args=[settings.host, settings.port, url],
            daemon=True,
        ).start()
    uvicorn.run(
        "shirube.adapters.api.app:app",
        host=settings.host,
        port=settings.port,
    )


if __name__ == "__main__":
    main()
