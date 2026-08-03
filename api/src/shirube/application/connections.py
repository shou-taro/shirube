"""Use cases for testing database connections."""

from shirube.application.connection_params import build_connection_params
from shirube.application.profiles import ProfileFields
from shirube.domain.connection import ConnectionParams, ConnectionProfile
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

    def test_candidate(
        self,
        profile_id: str,
        fields: ProfileFields,
        password: str | None,
    ) -> None:
        """Test a candidate edit to a saved profile *without persisting it*.

        The password is resolved exactly as saving resolves it — the newly-entered one, or the
        profile's stored password when the field is left blank — so the connection form can
        verify an edit before it overwrites the saved profile, the way creating verifies before
        saving. This lets a blank-password edit be tested without the client ever handling the
        secret, and lets an engine switch with no password (e.g. SQLite to PostgreSQL) be
        rejected safely before anything is written.

        Args:
            profile_id: The profile the edit applies to (also the keychain key for its
                stored password).
            fields: The edited non-secret fields to test.
            password: The newly-entered password, or ``None`` to reuse the stored one.

        Raises:
            ProfileNotFoundError: if no profile has that id.
            ConnectionFailedError: if the connection fails.
        """
        if self._repository.get(profile_id) is None:
            raise ProfileNotFoundError
        candidate = ConnectionProfile(
            id=profile_id,
            name=fields.name,
            target=fields.target,
            schemas=fields.schemas,
        )
        params = build_connection_params(candidate, self._secrets, password_override=password)
        self._connector.test_connection(params)
