"""Diagnostic logging setup.

shirube runs on a user's own machine against a user's own database, so when something
goes wrong there is no server-side log to inspect — the only record is whatever the tool
writes locally. This configures a ``shirube`` logger that writes to both the console and
a rotating file beside the app-state database, capturing what a developer needs to
diagnose a failure (the real cause behind a translated error, unexpected exceptions,
coarse request metadata) while deliberately never recording the *contents* a query
touched — no filter values, no row data, no passwords.
"""

import logging
from logging.handlers import RotatingFileHandler

from shirube.config import get_settings

# Timestamp, level, logger name, message — enough to place an event without being noisy.
_LOG_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"

# Keep the log small and self-limiting: a handful of rotations of a modest size, so it
# never grows without bound on a long-running install.
_MAX_BYTES = 1_000_000
_BACKUP_COUNT = 3


def setup_logging() -> logging.Logger:
    """Configure and return the root ``shirube`` logger.

    Attaches a console handler and a rotating file handler (at ``settings.log_path``) to
    the ``shirube`` logger, at the configured level. The logger does not propagate, so
    these handlers own shirube's output and uvicorn's own logging is left untouched.
    Safe to call more than once — existing handlers are replaced rather than stacked.

    Returns:
        The configured ``shirube`` logger; child loggers (``shirube.*``) inherit it.
    """
    settings = get_settings()
    # The file lives beside the app-state database; make sure the directory is there
    # before the handler tries to open the file.
    settings.data_dir.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger("shirube")
    logger.setLevel(settings.log_level.upper())
    logger.propagate = False
    # Replace any handlers from a previous call so repeated setup never duplicates output.
    for handler in list(logger.handlers):
        logger.removeHandler(handler)

    formatter = logging.Formatter(_LOG_FORMAT)

    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    file_handler = RotatingFileHandler(
        settings.log_path,
        maxBytes=_MAX_BYTES,
        backupCount=_BACKUP_COUNT,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    return logger
