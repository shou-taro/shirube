"""Diagnostic logging setup.

shirube runs on a user's own machine against a user's own database, so when something
goes wrong there is no server-side log to inspect — the only record is whatever the tool
writes locally. Logging is *structured*: every event is a set of key/value pairs rather
than a hand-formatted string, so the same event can be rendered two ways — a colourised,
human-readable line on the console and one JSON object per line in the log file, ready to
grep or feed to a tool. Contextual keys (such as a per-request ``request_id``) are bound
once and attached to every event automatically.

Throughout, only *metadata* is recorded — the real cause behind a translated error,
unexpected exceptions, coarse request timings — and never the *contents* a query touched:
no filter values, no row data, no passwords. The read-only, local-first posture holds in
the log too.

The implementation layers `structlog` on top of the standard library's :mod:`logging`
rather than replacing it: structlog builds each event dict, then hands it to a stdlib
handler for emission. That keeps rotation, levels, uvicorn's own loggers and pytest's
``caplog`` all working exactly as they would with plain :mod:`logging`.
"""

import logging
from logging.handlers import RotatingFileHandler
from typing import cast

import structlog

from shirube.config import get_settings

# Keep the log small and self-limiting: a handful of rotations of a modest size, so it
# never grows without bound on a long-running install.
_MAX_BYTES = 1_000_000
_BACKUP_COUNT = 3

# Processors run against every event on its way out, whether it originates from structlog
# or from a foreign (plain stdlib) logger routed through our handlers. They enrich the
# event dict — merge any bound context, stamp the level, name and time, and turn an
# ``exc_info`` into a rendered traceback — but stop short of the final rendering, which
# differs between the console and the file.
_shared_processors: list[structlog.typing.Processor] = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.processors.TimeStamper(fmt="iso"),
    structlog.processors.StackInfoRenderer(),
    structlog.processors.format_exc_info,
]


def _configure_structlog() -> None:
    """Point structlog at the standard library so stdlib owns emission.

    structlog builds the event dict and then defers to a stdlib logger, which means the
    console/file handlers, levels and rotation configured in :func:`setup_logging` all
    apply — and pytest's ``caplog`` and uvicorn's own loggers keep working unchanged.

    Idempotent and free of any settings look-up, so it is safe to run at import time.
    This matters because the app is often exercised (in tests, via ``TestClient``)
    without :func:`setup_logging` ever being called; configuring structlog here means a
    log event still routes through the standard library either way.
    """
    structlog.configure(
        processors=[
            *_shared_processors,
            # Hand the finished event dict to a stdlib :class:`ProcessorFormatter`, which
            # renders it (see the formatters built in ``setup_logging``).
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )


def get_logger(name: str = "shirube") -> structlog.stdlib.BoundLogger:
    """Return a structured logger under the ``shirube`` namespace.

    Args:
        name: The logger name; defaults to the root ``shirube`` logger. Callers use a
            dotted child (e.g. ``shirube.request``) so the source of an event is visible
            in the log without changing where the handlers live.

    Returns:
        A bound logger whose ``.info(event, **fields)`` style records structured events.
    """
    # ``structlog.get_logger`` is typed as returning ``Any`` (the wrapper class is only
    # known at configure time); we configure ``BoundLogger``, so narrow it here.
    return cast(structlog.stdlib.BoundLogger, structlog.get_logger(name))


def setup_logging() -> structlog.stdlib.BoundLogger:
    """Configure the ``shirube`` logger's handlers and return a structured logger.

    Attaches two handlers to the ``shirube`` logger: a console handler that renders each
    event as a colourised, human-readable line, and a rotating file handler (at
    ``settings.log_path``) that writes one JSON object per line. Both share the same
    enrichment (:data:`_shared_processors`); only the final rendering differs. The logger
    does not propagate, so these handlers own shirube's output and uvicorn's own logging
    is left untouched. Safe to call more than once — existing handlers are replaced rather
    than stacked.

    Returns:
        The configured ``shirube`` structured logger; children (``shirube.*``) inherit it.
    """
    _configure_structlog()

    settings = get_settings()
    # The file lives beside the app-state database; make sure the directory is there
    # before the handler tries to open the file.
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    # Console: a colourised key/value line, easy for a human to scan while shirube runs.
    console_formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=_shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.dev.ConsoleRenderer(colors=True),
        ],
    )
    # File: one JSON object per line — stable, machine-readable, and greppable.
    file_formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=_shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
    )

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(console_formatter)

    file_handler = RotatingFileHandler(
        settings.log_path,
        maxBytes=_MAX_BYTES,
        backupCount=_BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(file_formatter)

    logger = logging.getLogger("shirube")
    logger.setLevel(settings.log_level.upper())
    logger.propagate = False
    # Replace any handlers from a previous call so repeated setup never duplicates output.
    for handler in list(logger.handlers):
        logger.removeHandler(handler)
    logger.addHandler(console_handler)
    logger.addHandler(file_handler)

    return get_logger("shirube")


# Configure structlog as soon as the module is imported, so a log event routes through
# the standard library even in code paths that never call setup_logging() (notably the
# app under test). setup_logging() then owns the handlers, levels and rotation.
_configure_structlog()
