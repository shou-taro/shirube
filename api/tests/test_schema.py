"""Tests for schema introspection.

The row-to-graph mapping is exercised directly with sample rows (no database needed),
and the endpoint is exercised with a fake inspector standing in for the real adapter.
"""

from collections.abc import Sequence

from fastapi.testclient import TestClient

from shirube.adapters.api.app import create_app
from shirube.adapters.api.dependencies import get_schema_inspector, get_secret_store
from shirube.adapters.postgres.schema_inspector import build_graph
from shirube.domain.connection import ConnectionParams
from shirube.domain.schema import (
    Column,
    ObjectKind,
    Relationship,
    RelationshipKind,
    SchemaGraph,
    SchemaObject,
)

_PROFILE = {
    "name": "shop",
    "host": "db.example.com",
    "port": 5432,
    "database": "shop",
    "username": "readonly",
    "password": "s3cret",
    "sslmode": "require",
}


# --- build_graph (pure mapping) ------------------------------------------------------


def test_build_graph_attaches_columns_and_maps_kinds() -> None:
    object_rows = [
        {"schema": "public", "name": "users", "kind": "r"},
        {"schema": "public", "name": "active_users", "kind": "v"},
    ]
    column_rows = [
        {
            "schema": "public",
            "table": "users",
            "name": "id",
            "data_type": "integer",
            "nullable": False,
            "is_primary_key": True,
        },
        {
            "schema": "public",
            "table": "users",
            "name": "email",
            "data_type": "text",
            "nullable": True,
            "is_primary_key": False,
        },
    ]

    graph = build_graph(object_rows, column_rows, [])

    users, active_users = graph.objects
    assert users.kind is ObjectKind.TABLE
    assert active_users.kind is ObjectKind.VIEW
    # Columns keep their row order, and the primary key is flagged.
    assert [column.name for column in users.columns] == ["id", "email"]
    assert users.columns[0].is_primary_key
    assert active_users.columns == ()


def test_build_graph_drops_relationships_to_unknown_objects() -> None:
    object_rows = [
        {"schema": "public", "name": "orders", "kind": "r"},
        {"schema": "public", "name": "users", "kind": "r"},
    ]
    relationship_rows = [
        {
            "constraint_name": "orders_user_id_fkey",
            "source_schema": "public",
            "source_table": "orders",
            "target_schema": "public",
            "target_table": "users",
            "source_columns": ["user_id"],
            "target_columns": ["id"],
        },
        # References a table outside the loaded set — must be dropped.
        {
            "constraint_name": "orders_region_fkey",
            "source_schema": "public",
            "source_table": "orders",
            "target_schema": "other",
            "target_table": "regions",
            "source_columns": ["region_id"],
            "target_columns": ["id"],
        },
    ]

    graph = build_graph(object_rows, [], relationship_rows)

    assert len(graph.relationships) == 1
    kept = graph.relationships[0]
    assert kept.source == "public.orders"
    assert kept.target == "public.users"
    assert kept.source_columns == ("user_id",)
    assert kept.kind is RelationshipKind.FOREIGN_KEY


def test_build_graph_adds_view_dependencies_with_known_endpoints() -> None:
    object_rows = [
        {"schema": "public", "name": "users", "kind": "r"},
        {"schema": "public", "name": "active_users", "kind": "v"},
    ]
    dependency_rows = [
        # The view reads a loaded table — kept as a view dependency.
        {
            "view_schema": "public",
            "view_name": "active_users",
            "ref_schema": "public",
            "ref_name": "users",
        },
        # Reads a table outside the loaded set — dropped, like a foreign key would be.
        {
            "view_schema": "public",
            "view_name": "active_users",
            "ref_schema": "other",
            "ref_name": "audit",
        },
    ]

    graph = build_graph(object_rows, [], [], dependency_rows)

    assert len(graph.relationships) == 1
    dependency = graph.relationships[0]
    assert dependency.kind is RelationshipKind.VIEW_DEPENDENCY
    assert dependency.source == "public.active_users"
    assert dependency.target == "public.users"
    # A view dependency carries no columns of its own.
    assert dependency.source_columns == ()
    assert dependency.target_columns == ()


# --- endpoint ------------------------------------------------------------------------


class FakeSchemaInspector:
    """Returns a canned graph and records how it was called."""

    def __init__(self, graph: SchemaGraph) -> None:
        self._graph = graph
        self.calls: list[tuple[ConnectionParams, tuple[str, ...]]] = []

    def inspect(self, params: ConnectionParams, schemas: Sequence[str]) -> SchemaGraph:
        self.calls.append((params, tuple(schemas)))
        return self._graph


class FakeSecretStore:
    """In-memory stand-in for the OS keychain."""

    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    def get_password(self, profile_id: str) -> str | None:
        return self._store.get(profile_id)

    def set_password(self, profile_id: str, password: str) -> None:
        self._store[profile_id] = password

    def delete_password(self, profile_id: str) -> None:
        self._store.pop(profile_id, None)


_GRAPH = SchemaGraph(
    objects=(
        SchemaObject(
            schema="public",
            name="users",
            kind=ObjectKind.TABLE,
            columns=(Column("id", "integer", nullable=False, is_primary_key=True),),
        ),
        SchemaObject(
            schema="public",
            name="orders",
            kind=ObjectKind.TABLE,
            columns=(Column("user_id", "integer", nullable=False),),
        ),
    ),
    relationships=(
        Relationship(
            constraint_name="orders_user_id_fkey",
            source="public.orders",
            source_columns=("user_id",),
            target="public.users",
            target_columns=("id",),
        ),
    ),
)


def _client(inspector: FakeSchemaInspector, secrets: FakeSecretStore) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_schema_inspector] = lambda: inspector
    app.dependency_overrides[get_secret_store] = lambda: secrets
    return TestClient(app)


def test_get_schema_returns_graph() -> None:
    inspector = FakeSchemaInspector(_GRAPH)
    with _client(inspector, FakeSecretStore()) as client:
        created = client.post("/api/profiles", json={**_PROFILE, "schemas": ["public"]}).json()
        response = client.get(f"/api/profiles/{created['id']}/schema")

    assert response.status_code == 200
    body = response.json()
    users = body["objects"][0]
    assert users["schema"] == "public"
    assert users["id"] == "public.users"
    assert users["columns"][0]["is_primary_key"] is True
    assert body["relationships"][0]["target"] == "public.users"
    # The saved password and requested schemas reached the inspector.
    params, schemas = inspector.calls[0]
    assert params.password == "s3cret"
    assert schemas == ("public",)


def test_get_schema_missing_profile_returns_404() -> None:
    inspector = FakeSchemaInspector(_GRAPH)
    with _client(inspector, FakeSecretStore()) as client:
        response = client.get("/api/profiles/does-not-exist/schema")

    assert response.status_code == 404
