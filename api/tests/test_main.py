"""Tests for the launcher's browser-readiness poll.

These drive the real socket path without starting the full server: bind a listening
socket for the ready case, and point at a closed port for the timeout case.
"""

import socket

from shirube.__main__ import _port_in_use, _wait_until_ready


def test_wait_until_ready_returns_true_once_the_port_listens() -> None:
    """A listening socket is detected promptly, well within the timeout."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        _, port = server.getsockname()
        assert _wait_until_ready("127.0.0.1", port, timeout=5.0) is True


def test_wait_until_ready_gives_up_when_nothing_listens() -> None:
    """With no server on the port, the poll returns False after the timeout."""
    # Grab a port, then close it so nothing is listening there.
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        _, port = probe.getsockname()
    assert _wait_until_ready("127.0.0.1", port, timeout=0.3) is False


def test_port_in_use_detects_a_live_listener() -> None:
    """A bound, listening port is reported as in use; a free one is not."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        _, port = server.getsockname()
        assert _port_in_use("127.0.0.1", port) is True
    # Once closed, the same port is free again.
    assert _port_in_use("127.0.0.1", port) is False
