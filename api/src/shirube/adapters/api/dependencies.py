"""FastAPI dependency providers wiring adapters to the application core.

Routes depend on these, and tests override them to inject fakes — which is how the
onion's dependency inversion shows up at the HTTP edge.
"""

from typing import Annotated

from fastapi import Depends

from shirube.adapters.ai.factory import build_provider
from shirube.adapters.keyring.secret_store import KeyringSecretStore
from shirube.adapters.persistence.ai_config_repository import SqlAiConfigRepository
from shirube.adapters.persistence.database import get_session_factory
from shirube.adapters.persistence.profile_repository import SqlProfileRepository
from shirube.adapters.postgres.connector import PostgresConnector
from shirube.adapters.postgres.data_reader import PostgresDataReader
from shirube.adapters.postgres.schema_inspector import PostgresSchemaInspector
from shirube.application.ai_config import AI_PROVIDER_SECRET_ID, AiConfigService
from shirube.application.connections import ConnectionService
from shirube.application.data import DataService
from shirube.application.navigator import NavigatorService
from shirube.application.profiles import ProfileService
from shirube.application.schema import SchemaService
from shirube.domain.errors import ProviderNotConfiguredError
from shirube.ports.repositories import (
    AiConfigRepository,
    AiProvider,
    DatabaseConnector,
    DataReader,
    ProfileRepository,
    SchemaInspector,
    SecretStore,
)


def get_profile_repository() -> ProfileRepository:
    """Provide the profile repository backed by the app-state database."""
    return SqlProfileRepository(get_session_factory())


def get_secret_store() -> SecretStore:
    """Provide the OS-keychain secret store."""
    return KeyringSecretStore()


def get_ai_config_repository() -> AiConfigRepository:
    """Provide the AI provider config repository backed by the app-state database."""
    return SqlAiConfigRepository(get_session_factory())


def get_database_connector() -> DatabaseConnector:
    """Provide the PostgreSQL connector."""
    return PostgresConnector()


def get_schema_inspector() -> SchemaInspector:
    """Provide the PostgreSQL schema inspector."""
    return PostgresSchemaInspector()


def get_data_reader() -> DataReader:
    """Provide the PostgreSQL row-preview reader."""
    return PostgresDataReader()


def get_profile_service(
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
    secrets: Annotated[SecretStore, Depends(get_secret_store)],
) -> ProfileService:
    """Compose the profile service from its repository and secret store."""
    return ProfileService(repository, secrets)


def get_connection_service(
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
    secrets: Annotated[SecretStore, Depends(get_secret_store)],
    connector: Annotated[DatabaseConnector, Depends(get_database_connector)],
) -> ConnectionService:
    """Compose the connection service from the repository, secret store and connector."""
    return ConnectionService(repository, secrets, connector)


def get_schema_service(
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
    secrets: Annotated[SecretStore, Depends(get_secret_store)],
    inspector: Annotated[SchemaInspector, Depends(get_schema_inspector)],
) -> SchemaService:
    """Compose the schema service from the repository, secret store and inspector."""
    return SchemaService(repository, secrets, inspector)


def get_data_service(
    repository: Annotated[ProfileRepository, Depends(get_profile_repository)],
    secrets: Annotated[SecretStore, Depends(get_secret_store)],
    reader: Annotated[DataReader, Depends(get_data_reader)],
) -> DataService:
    """Compose the data service from the repository, secret store and row reader."""
    return DataService(repository, secrets, reader)


def get_ai_config_service(
    repository: Annotated[AiConfigRepository, Depends(get_ai_config_repository)],
    secrets: Annotated[SecretStore, Depends(get_secret_store)],
) -> AiConfigService:
    """Compose the AI config service from the config repository and secret store."""
    return AiConfigService(repository, secrets)


def get_ai_provider(
    config_service: Annotated[AiConfigService, Depends(get_ai_config_service)],
    secrets: Annotated[SecretStore, Depends(get_secret_store)],
) -> AiProvider:
    """Build the configured provider adapter, reading its API key from the keychain.

    This is where the concrete adapter choice lives — the application layer only ever sees
    the :class:`AiProvider` port. The provider is built fresh per request so a configuration
    change takes effect immediately.

    Raises:
        ProviderNotConfiguredError: if no provider has been configured yet.
        InvalidProviderConfigError: if the stored configuration is incomplete (raised by the
            factory, e.g. an OpenAI-compatible provider with no base URL).
    """
    status = config_service.get()
    if status.config is None:
        raise ProviderNotConfiguredError
    api_key = secrets.get_password(AI_PROVIDER_SECRET_ID)
    return build_provider(status.config, api_key)


def get_navigator_service(
    schema: Annotated[SchemaService, Depends(get_schema_service)],
    provider: Annotated[AiProvider, Depends(get_ai_provider)],
) -> NavigatorService:
    """Compose the navigator from the schema service and the configured provider."""
    return NavigatorService(schema, provider)
