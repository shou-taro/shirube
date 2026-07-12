"""FastAPI dependency providers wiring adapters to the application core.

Routes depend on these, and tests override them to inject fakes — which is how the
onion's dependency inversion shows up at the HTTP edge.
"""

from typing import Annotated

from fastapi import Depends

from shirube.adapters.keyring.secret_store import KeyringSecretStore
from shirube.adapters.persistence.database import get_session_factory
from shirube.adapters.persistence.profile_repository import SqlProfileRepository
from shirube.application.profiles import ProfileService
from shirube.ports.repositories import ProfileRepository, SecretStore


def get_profile_repository() -> ProfileRepository:
    """Provide the profile repository backed by the app-state database."""
    return SqlProfileRepository(get_session_factory())


def get_secret_store() -> SecretStore:
    """Provide the OS-keychain secret store."""
    return KeyringSecretStore()


def get_profile_service(
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
    secrets: Annotated[SecretStore, Depends(get_secret_store)],
) -> ProfileService:
    """Compose the profile service from its repository and secret store."""
    return ProfileService(repository, secrets)
