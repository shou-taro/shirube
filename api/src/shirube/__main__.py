"""Entry point for ``shirube`` / ``uvx shirube``.

Starts the local API server (which also serves the bundled single-page app in a
packaged build) and, unless disabled, opens the browser once the server is up.
"""

import errno
import socket
import sys
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


def _wait_until_ready(host: str, port: int, timeout: float) -> bool:
    """Poll until the server accepts a TCP connection, or ``timeout`` elapses.

    Args:
        host: The host the server is bound to.
        port: The port the server is listening on.
        timeout: Maximum seconds to wait before giving up.

    Returns:
        True once a connection succeeds; False if the timeout is reached first.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(BROWSER_POLL_INTERVAL_SECONDS)
    return False


def _port_in_use(host: str, port: int) -> bool:
    """Whether ``port`` on ``host`` is already taken by a live listener.

    Binding briefly is the reliable check. Only "address already in use" counts as taken;
    any other bind error (e.g. an address family we can't probe) is treated as free, so
    the pre-flight never blocks a start it shouldn't — uvicorn's own bind is the backstop.

    Args:
        host: The host the server will bind to.
        port: The port the server will bind to.

    Returns:
        True if the port is already in use, False otherwise.
    """
    try:
        with socket.create_server((host, port)):
            return False
    except OSError as exc:
        return exc.errno == errno.EADDRINUSE


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

    Binds to loopback (fixed) and the configured port, and blocks while uvicorn runs. A
    background thread waits for the server to accept connections and then opens the
    browser, so the launch never races ahead of a slow start-up.
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
    # Fail early and clearly if the port is taken, rather than letting uvicorn's bind
    # error scroll past — and before the browser thread starts, so it can't open onto
    # whatever else is already listening there (e.g. an existing shirube instance).
    if _port_in_use(settings.host, settings.port):
        logger.error("port_in_use", host=settings.host, port=settings.port)
        print(
            f"shirube could not start: port {settings.port} is already in use on "
            f"{settings.host}.\nAnother shirube may already be running — open "
            f"http://{settings.host}:{settings.port} — or set SHIRUBE_PORT to a free "
            "port.",
            file=sys.stderr,
        )
        raise SystemExit(1)
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
