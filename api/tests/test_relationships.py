"""Tests for manual relationships — the links a user draws that the database omits.

The service is exercised directly with an in-memory repository, and the endpoints plus
their merge into the schema graph are exercised through the app with a fake inspector.
"""

import pytest
from fastapi.testclient import TestClient

from shirube.adapters.api.app import create_app
from shirube.adapters.api.dependencies import get_schema_inspector, get_secret_store
from shirube.adapters.persistence.database import get_session_factory
from shirube.adapters.persistence.manual_relationship_repository import (
    SqlManualRelationshipRepository,
)
from shirube.application.relationships import ManualRelationshipService
from shirube.domain.connection import (
    ConnectionParams,
    ConnectionProfile,
    PostgresTarget,
    SslMode,
)
from shirube.domain.errors import (
    DuplicateManualRelationshipError,
    InvalidManualRelationshipError,
    ManualRelationshipNotFoundError,
    ProfileNotFoundError,
)
from shirube.domain.schema import (
    Column,
    ManualRelationship,
    ObjectKind,
    SchemaGraph,
    SchemaObject,
)

_PROFILE = {
    "kind": "postgresql",
    "name": "shop",
    "host": "db.example.com",
    "port": 5432,
    "database": "shop",
    "username": "readonly",
    "password": "s3cret",
    "sslmode": "require",
    "schemas": ["public"],
}

# Two connected tables, so a manual link between them has both endpoints present.
_GRAPH = SchemaGraph(
    objects=(
        SchemaObject(
            schema="public",
            name="customer",
            kind=ObjectKind.TABLE,
            columns=(Column("store_id", "integer", nullable=False),),
        ),
        SchemaObject(
            schema="public",
            name="store",
            kind=ObjectKind.TABLE,
            columns=(Column("store_id", "integer", nullable=False, is_primary_key=True),),
        ),
    ),
)

_LINK = {
    "source_schema": "public",
    "source_table": "customer",
    "source_column": "store_id",
    "target_schema": "public",
    "target_table": "store",
    "target_column": "store_id",
}


# --- service (in-memory repository) --------------------------------------------------


class FakeManualRepo:
    """In-memory stand-in for the manual-relationship repository."""

    def __init__(self) -> None:
        self._rows: dict[str, ManualRelationship] = {}

    def list_for_profile(self, profile_id: str) -> list[ManualRelationship]:
        return [r for r in self._rows.values() if r.profile_id == profile_id]

    def get(self, relationship_id: str) -> ManualRelationship | None:
        return self._rows.get(relationship_id)

    def add(self, relationship: ManualRelationship) -> None:
        self._rows[relationship.id] = relationship

    def delete(self, relationship_id: str) -> None:
        self._rows.pop(relationship_id, None)

    def delete_for_profile(self, profile_id: str) -> None:
        self._rows = {rid: row for rid, row in self._rows.items() if row.profile_id != profile_id}


class FakeProfileRepo:
    """In-memory profile lookup; only the ids in ``known`` exist."""

    def __init__(self, known: set[str]) -> None:
        self._known = known

    def get(self, profile_id: str) -> ConnectionProfile | None:
        if profile_id not in self._known:
            return None
        return ConnectionProfile(
            id=profile_id,
            name="shop",
            target=PostgresTarget(
                host="db.example.com",
                port=5432,
                database="shop",
                username="readonly",
                sslmode=SslMode.REQUIRE,
            ),
            schemas=("public",),
        )


def _service(known: set[str] = frozenset({"p1"})) -> ManualRelationshipService:
    return ManualRelationshipService(
        FakeManualRepo(),  # type: ignore[arg-type]
        FakeProfileRepo(set(known)),  # type: ignore[arg-type]
    )


def test_add_assigns_an_id_and_persists() -> None:
    service = _service()

    created = service.add(profile_id="p1", **_LINK)

    assert created.id
    assert service.list("p1") == [created]


def test_add_to_an_unknown_profile_is_not_found() -> None:
    service = _service(known=set())

    with pytest.raises(ProfileNotFoundError):
        service.add(profile_id="ghost", **_LINK)


def test_add_refuses_a_duplicate() -> None:
    service = _service()
    service.add(profile_id="p1", **_LINK)

    with pytest.raises(DuplicateManualRelationshipError):
        service.add(profile_id="p1", **_LINK)


def test_add_refuses_linking_a_column_to_itself() -> None:
    service = _service()

    with pytest.raises(InvalidManualRelationshipError):
        service.add(
            profile_id="p1",
            source_schema="public",
            source_table="customer",
            source_column="id",
            target_schema="public",
            target_table="customer",
            target_column="id",
        )


def test_add_allows_a_self_reference_on_a_different_column() -> None:
    service = _service()

    created = service.add(
        profile_id="p1",
        source_schema="public",
        source_table="employee",
        source_column="manager_id",
        target_schema="public",
        target_table="employee",
        target_column="id",
    )

    assert created.id


def test_delete_removes_it() -> None:
    service = _service()
    created = service.add(profile_id="p1", **_LINK)

    service.delete("p1", created.id)

    assert service.list("p1") == []


def test_delete_unknown_is_not_found() -> None:
    service = _service()

    with pytest.raises(ManualRelationshipNotFoundError):
        service.delete("p1", "nope")


def test_delete_is_scoped_to_the_profile() -> None:
    service = _service()
    created = service.add(profile_id="p1", **_LINK)

    # Another profile must not be able to delete p1's relationship.
    with pytest.raises(ManualRelationshipNotFoundError):
        service.delete("p2", created.id)


# --- endpoints + merge into the schema graph -----------------------------------------


class FakeSchemaInspector:
    def __init__(self, graph: SchemaGraph) -> None:
        self._graph = graph

    def inspect(self, params: ConnectionParams, schemas: object) -> SchemaGraph:
        return self._graph


class FakeSecretStore:
    def __init__(self) -> None:
        self._store: dict[str, str] = {}

    def get_password(self, profile_id: str) -> str | None:
        return self._store.get(profile_id)

    def set_password(self, profile_id: str, password: str) -> None:
        self._store[profile_id] = password

    def delete_password(self, profile_id: str) -> None:
        self._store.pop(profile_id, None)


def _client(graph: SchemaGraph = _GRAPH) -> TestClient:
    app = create_app()
    app.dependency_overrides[get_schema_inspector] = lambda: FakeSchemaInspector(graph)
    app.dependency_overrides[get_secret_store] = lambda: FakeSecretStore()
    return TestClient(app)


def _create_profile(client: TestClient) -> str:
    return client.post("/api/profiles", json=_PROFILE).json()["id"]


def _manual_edges(client: TestClient, profile_id: str) -> list[dict]:
    body = client.get(f"/api/profiles/{profile_id}/schema").json()
    return [edge for edge in body["relationships"] if edge["kind"] == "manual"]


def test_created_relationship_is_drawn_on_the_schema_graph() -> None:
    with _client() as client:
        profile_id = _create_profile(client)

        created = client.post(f"/api/profiles/{profile_id}/relationships", json=_LINK)
        assert created.status_code == 201
        relationship_id = created.json()["id"]

        edges = _manual_edges(client, profile_id)

    assert len(edges) == 1
    edge = edges[0]
    assert edge["id"] == relationship_id
    assert edge["source"] == "public.customer"
    assert edge["target"] == "public.store"
    assert edge["source_columns"] == ["store_id"]
    assert edge["target_columns"] == ["store_id"]


def test_relationship_to_a_missing_table_is_not_drawn() -> None:
    with _client() as client:
        profile_id = _create_profile(client)
        client.post(
            f"/api/profiles/{profile_id}/relationships",
            json={**_LINK, "target_table": "does_not_exist"},
        )

        assert _manual_edges(client, profile_id) == []


def test_duplicate_relationship_returns_409() -> None:
    with _client() as client:
        profile_id = _create_profile(client)
        client.post(f"/api/profiles/{profile_id}/relationships", json=_LINK)

        again = client.post(f"/api/profiles/{profile_id}/relationships", json=_LINK)

    assert again.status_code == 409


def test_self_link_returns_400() -> None:
    with _client() as client:
        profile_id = _create_profile(client)
        response = client.post(
            f"/api/profiles/{profile_id}/relationships",
            json={
                "source_schema": "public",
                "source_table": "customer",
                "source_column": "store_id",
                "target_schema": "public",
                "target_table": "customer",
                "target_column": "store_id",
            },
        )

    assert response.status_code == 400


def test_delete_removes_the_edge() -> None:
    with _client() as client:
        profile_id = _create_profile(client)
        relationship_id = client.post(
            f"/api/profiles/{profile_id}/relationships", json=_LINK
        ).json()["id"]

        deleted = client.delete(f"/api/profiles/{profile_id}/relationships/{relationship_id}")
        assert deleted.status_code == 204

        assert _manual_edges(client, profile_id) == []


def test_delete_unknown_returns_404() -> None:
    with _client() as client:
        profile_id = _create_profile(client)
        response = client.delete(f"/api/profiles/{profile_id}/relationships/nope")

    assert response.status_code == 404


def test_create_for_an_unknown_profile_returns_404() -> None:
    with _client() as client:
        response = client.post("/api/profiles/ghost/relationships", json=_LINK)

    assert response.status_code == 404


def test_deleting_a_profile_removes_its_manual_relationships() -> None:
    with _client() as client:
        profile_id = _create_profile(client)
        client.post(f"/api/profiles/{profile_id}/relationships", json=_LINK)

        assert client.delete(f"/api/profiles/{profile_id}").status_code == 204

    # The link must not linger as an orphan row once its profile is gone.
    repository = SqlManualRelationshipRepository(get_session_factory())
    assert repository.list_for_profile(profile_id) == []
