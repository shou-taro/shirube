"""Use cases for introspecting a database schema."""

from shirube.application.connection_params import build_connection_params
from shirube.domain.errors import ProfileNotFoundError
from shirube.domain.schema import ManualRelationship, Relationship, SchemaGraph
from shirube.ports.repositories import (
    ManualRelationshipRepository,
    ProfileRepository,
    SchemaInspector,
    SecretStore,
)


class SchemaService:
    """Reads the schema of a saved connection as a graph for the ER map.

    Alongside the foreign keys and view dependencies read from the database, the graph
    carries any relationships the user drew for the profile (see
    :class:`~shirube.application.relationships.ManualRelationshipService`), merged in as
    ``MANUAL`` edges so the map draws the whole picture at once.
    """

    def __init__(
        self,
        repository: ProfileRepository,
        secrets: SecretStore,
        inspector: SchemaInspector,
        manual_relationships: ManualRelationshipRepository,
    ) -> None:
        self._repository = repository
        self._secrets = secrets
        self._inspector = inspector
        self._manual_relationships = manual_relationships

    def introspect_profile(self, profile_id: str) -> SchemaGraph:
        """Introspect a saved profile's database, using its keychain password.

        Args:
            profile_id: The profile to introspect.

        Returns:
            The database schema as a graph of objects and relationships, including the
            profile's manual relationships.

        Raises:
            ProfileNotFoundError: if no profile has that id.
            ConnectionFailedError: if the database cannot be reached or read.
        """
        profile = self._repository.get(profile_id)
        if profile is None:
            raise ProfileNotFoundError
        params = build_connection_params(profile, self._secrets)
        graph = self._inspector.inspect(params, profile.schemas)
        manual = self._manual_relationships.list_for_profile(profile_id)
        return SchemaGraph(
            objects=graph.objects,
            relationships=graph.relationships + self._manual_edges(manual, graph),
        )

    @staticmethod
    def _manual_edges(
        manual: list[ManualRelationship],
        graph: SchemaGraph,
    ) -> tuple[Relationship, ...]:
        """Render the manual relationships whose endpoints are both present in the graph.

        A link whose table has since been renamed, dropped, or excluded from the shown
        schemas (or folded away as a partition child) is skipped rather than drawn as an
        edge to nowhere.
        """
        object_ids = {obj.id for obj in graph.objects}
        return tuple(
            relationship.as_edge()
            for relationship in manual
            if relationship.source_object_id in object_ids
            and relationship.target_object_id in object_ids
        )
