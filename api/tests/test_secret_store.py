"""Tests for the keychain-backed secret store's error translation.

The real ``keyring`` module is monkeypatched so these never touch the OS keychain: they
just assert that its failures become a :class:`SecretStoreError`, and that a
delete-of-an-absent-password stays a no-op.
"""

import keyring.errors
import pytest

from shirube.adapters.keyring.secret_store import KeyringSecretStore
from shirube.domain.errors import SecretStoreError


def _raise_keyring_error(*_args: object, **_kwargs: object) -> None:
    raise keyring.errors.KeyringError("keychain is locked")


def test_get_password_translates_keyring_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("keyring.get_password", _raise_keyring_error)
    with pytest.raises(SecretStoreError):
        KeyringSecretStore().get_password("p1")


def test_set_password_translates_keyring_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("keyring.set_password", _raise_keyring_error)
    with pytest.raises(SecretStoreError):
        KeyringSecretStore().set_password("p1", "secret")


def test_delete_password_translates_keyring_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("keyring.delete_password", _raise_keyring_error)
    with pytest.raises(SecretStoreError):
        KeyringSecretStore().delete_password("p1")


def test_delete_password_ignores_an_absent_password(monkeypatch: pytest.MonkeyPatch) -> None:
    """A password that is already gone is not an error — deletion is idempotent."""

    def _raise_delete_error(*_args: object, **_kwargs: object) -> None:
        raise keyring.errors.PasswordDeleteError("not found")

    monkeypatch.setattr("keyring.delete_password", _raise_delete_error)
    KeyringSecretStore().delete_password("p1")  # does not raise
