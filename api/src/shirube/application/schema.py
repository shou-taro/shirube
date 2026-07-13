"""Use cases for introspecting a database schema."""

from shirube.domain.connection import ConnectionParams
from shirube.domain.errors import ProfileNotFoundError
from shirube.domain.schema import SchemaGraph
from shirube.ports.repositories import ProfileRepository, SchemaInspector, SecretStore


class SchemaService:
    """Reads the schema of a saved connection as a graph for the ER map."""

    def __init__(
        self,
        repository: ProfileRepository,
        secrets: SecretStore,
        inspector: SchemaInspector,
    ) -> None:
        self._repository = repository
        self._secrets = secrets
        self._inspector = inspector

    def introspect_profile(self, profile_id: str) -> SchemaGraph:
        """Introspect a saved profile's database, using its keychain password.

        Args:
            profile_id: The profile to introspect.

        Returns:
            The database schema as a graph of objects and relationships.

        Raises:
            ProfileNotFoundError: if no profile has that id.
            ConnectionFailedError: if the database cannot be reached or read.
        """
        profile = self._repository.get(profile_id)
        if profile is None:
            raise ProfileNotFoundError
        params = ConnectionParams(
            host=profile.host,
            port=profile.port,
            database=profile.database,
            username=profile.username,
            password=self._secrets.get_password(profile_id) or "",
            sslmode=profile.sslmode,
        )
        return self._inspector.inspect(params, profile.schemas)
