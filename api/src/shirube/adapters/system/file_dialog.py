"""Open a native file-open dialog on the user's machine — the SQLite path picker.

A browser can never hand the backend a file's real path (it hides it for security), yet
shirube opens a SQLite file *by path*. Because shirube runs locally, the server can show the
OS file dialog itself and read back the chosen path. ``tkinter`` (in the standard library)
gives one cross-platform implementation; running it in a short-lived **subprocess** keeps Tk
off the server thread and out of the request's event loop — Tk is not thread-safe — and
isolates any Tk or display failure into a clean exit code.

When no dialog can be shown — a headless or SSH session, or a Python built without Tk — the
picker raises :class:`FileDialogUnavailableError` and the caller falls back to the text field.
"""

import subprocess  # nosec B404 - used only to run our own interpreter with a fixed script
import sys

from shirube.domain.errors import FileDialogUnavailableError

# A self-contained tkinter program: pop a modal file-open dialog and print the chosen path
# (empty on cancel). Kept as one string so it runs via ``python -c`` in the subprocess.
_PICKER_SCRIPT = """
import tkinter as tk
from tkinter import filedialog

root = tk.Tk()
root.withdraw()
root.attributes("-topmost", True)
path = filedialog.askopenfilename(
    title="Choose a SQLite database",
    filetypes=[("SQLite database", "*.sqlite *.sqlite3 *.db"), ("All files", "*.*")],
)
root.destroy()
print(path)
"""

# Generous: the subprocess is blocked on the user, who may take a while to browse and choose.
_DIALOG_TIMEOUT_SECONDS = 300


def pick_sqlite_file() -> str | None:
    """Show a native file-open dialog and return the chosen path.

    Returns:
        The absolute path the user chose, or ``None`` if they cancelled.

    Raises:
        FileDialogUnavailableError: if no dialog could be shown (Tk or a display is missing,
            or the subprocess could not be started).
    """
    try:
        result = subprocess.run(  # nosec B603 - our own interpreter, fixed script, no shell
            [sys.executable, "-c", _PICKER_SCRIPT],
            capture_output=True,
            text=True,
            timeout=_DIALOG_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise FileDialogUnavailableError from exc
    if result.returncode != 0:
        # A non-zero exit means tkinter could not start — no Tk in this Python, or no display.
        raise FileDialogUnavailableError
    # The script prints the path (or an empty line on cancel); strip only the trailing newline
    # so a path is preserved exactly.
    path = result.stdout.rstrip("\r\n")
    return path or None
