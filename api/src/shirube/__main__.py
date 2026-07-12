"""Entry point: launch the local server and open the browser."""

import threading
import webbrowser

import uvicorn

from shirube.config import get_settings


def _open_browser(url: str) -> None:
    webbrowser.open(url)


def main() -> None:
    settings = get_settings()
    url = f"http://{settings.host}:{settings.port}"
    if settings.open_browser:
        threading.Timer(1.0, _open_browser, args=[url]).start()
    uvicorn.run(
        "shirube.adapters.api.app:app",
        host=settings.host,
        port=settings.port,
    )


if __name__ == "__main__":
    main()
