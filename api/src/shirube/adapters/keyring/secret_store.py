"""OS keychain implementation of the secret store."""

import keyring
from keyring.errors import PasswordDeleteError

_SERVICE = "shirube"


class KeyringSecretStore:
    """Stores per-profile passwords in the OS keychain via ``keyring``.

    Secrets are namespaced under the ``shirube`` service and keyed by profile id, so a
    password never touches the app-state database or any config file. The concrete
    backend is whatever ``keyring`` resolves for the platform (macOS Keychain, Windows
    Credential Manager, or the Linux Secret Service).
    """

    def get_password(self, profile_id: str) -> str | None:
        """Return the stored password for ``profile_id``, or ``None`` if there is none."""
        return keyring.get_password(_SERVICE, profile_id)

    def set_password(self, profile_id: str, password: str) -> None:
        """Store (or replace) the password for ``profile_id``."""
        keyring.set_password(_SERVICE, profile_id, password)

    def delete_password(self, profile_id: str) -> None:
        """Remove the password for ``profile_id``; a no-op if none is stored."""
        try:
            keyring.delete_password(_SERVICE, profile_id)
        except PasswordDeleteError:
            # Already absent — nothing to remove.
            pass
