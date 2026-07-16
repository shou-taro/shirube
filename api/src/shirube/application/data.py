"""Use cases for previewing a connected object's rows."""

from shirube.domain.connection import ConnectionParams
from shirube.domain.data import RowPage, RowQuery
from shirube.domain.errors import ProfileNotFoundError
from shirube.ports.repositories import DataReader, ProfileRepository, SecretStore


class DataService:
    """Reads a page of rows from an object of a saved connection, read-only."""

    def __init__(
        self,
        repository: ProfileRepository,
        secrets: SecretStore,
        reader: DataReader,
    ) -> None:
        self._repository = repository
        self._secrets = secrets
        self._reader = reader

    def read_rows(
        self,
        profile_id: str,
        object_id: str,
        query: RowQuery,
    ) -> RowPage:
        """Read a page of an object's rows, using the profile's keychain password.

        Args:
            profile_id: The profile whose database holds the object.
            object_id: The ``schema.name`` id of the table or view to read.
            query: The page to read — limit, offset, sort and filters.

        Returns:
            The requested page of rows.

        Raises:
            ProfileNotFoundError: if no profile has that id.
            ObjectNotFoundError: if the object is not in the profile's database.
            InvalidQueryError: if the query names a column the object does not have.
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
        return self._reader.read_rows(params, profile.schemas, object_id, query)
