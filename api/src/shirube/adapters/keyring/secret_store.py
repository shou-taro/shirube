"""OS keychain implementation of the secret store."""

import keyring
from keyring.errors import KeyringError, PasswordDeleteError

from shirube.domain.errors import SecretStoreError

_SERVICE = "shirube"


class KeyringSecretStore:
    """Stores per-profile passwords in the OS keychain via ``keyring``.

    Secrets are namespaced under the ``shirube`` service and keyed by profile id, so a
    password never touches the app-state database or any config file. The concrete
    backend is whatever ``keyring`` resolves for the platform (macOS Keychain, Windows
    Credential Manager, or the Linux Secret Service).

    A keychain that is locked, unavailable, or refuses access raises ``keyring``'s own
    errors; these are translated into :class:`SecretStoreError` so the API returns a
    clean, actionable message rather than an unhandled 500.
    """

    def get_password(self, profile_id: str) -> str | None:
        """Return the stored password for ``profile_id``, or ``None`` if there is none.

        Raises:
            SecretStoreError: if the keychain cannot be read.
        """
        try:
            return keyring.get_password(_SERVICE, profile_id)
        except KeyringError as exc:
            raise SecretStoreError(
                "Could not read the password from the OS keychain. It may be locked, "
                "or shirube may have been denied access."
            ) from exc

    def set_password(self, profile_id: str, password: str) -> None:
        """Store (or replace) the password for ``profile_id``.

        Raises:
            SecretStoreError: if the keychain cannot be written.
        """
        try:
            keyring.set_password(_SERVICE, profile_id, password)
        except KeyringError as exc:
            raise SecretStoreError(
                "Could not save the password to the OS keychain. It may be locked, or "
                "shirube may have been denied access."
            ) from exc

    def delete_password(self, profile_id: str) -> None:
        """Remove the password for ``profile_id``; a no-op if none is stored.

        Raises:
            SecretStoreError: if the keychain cannot be reached (other than the password
                simply being absent, which is ignored).
        """
        try:
            keyring.delete_password(_SERVICE, profile_id)
        except PasswordDeleteError:
            # Already absent — nothing to remove.
            pass
        except KeyringError as exc:
            raise SecretStoreError(
                "Could not remove the password from the OS keychain. It may be locked, "
                "or shirube may have been denied access."
            ) from exc
