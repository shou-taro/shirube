"""Use cases for testing database connections."""

from shirube.application.connection_params import build_connection_params
from shirube.domain.connection import ConnectionParams
from shirube.domain.errors import ProfileNotFoundError
from shirube.ports.repositories import DatabaseConnector, ProfileRepository, SecretStore


class ConnectionService:
    """Tests whether a database can be reached with given or saved credentials."""

    def __init__(
        self,
        repository: ProfileRepository,
        secrets: SecretStore,
        connector: DatabaseConnector,
    ) -> None:
        self._repository = repository
        self._secrets = secrets
        self._connector = connector

    def test(self, params: ConnectionParams) -> None:
        """Test an ad-hoc set of connection parameters.

        Used by the connection form's "test connection" before a profile is saved.

        Raises:
            ConnectionFailedError: if the connection fails.
        """
        self._connector.test_connection(params)

    def test_profile(self, profile_id: str) -> None:
        """Test a saved profile, using its password from the keychain.

        Raises:
            ProfileNotFoundError: if no profile has that id.
            ConnectionFailedError: if the connection fails.
        """
        profile = self._repository.get(profile_id)
        if profile is None:
            raise ProfileNotFoundError
        params = build_connection_params(profile, self._secrets)
        self._connector.test_connection(params)
