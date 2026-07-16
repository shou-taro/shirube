"""Tests for row previewing.

The SQL assembly is exercised directly with sample inputs (no database needed), and the
endpoint is exercised with a fake reader standing in for the real adapter.
"""

from collections.abc import Sequence

import pytest
from fastapi.testclient import TestClient

from shirube.adapters.api.app import create_app
from shirube.adapters.api.dependencies import get_data_reader, get_secret_store
from shirube.adapters.postgres.data_reader import build_select
from shirube.domain.connection import ConnectionParams
from shirube.domain.data import (
    ColumnFilter,
    FilterOperator,
    RowPage,
    RowQuery,
    SortDirection,
    SortOrder,
)
from shirube.domain.errors import InvalidQueryError, ObjectNotFoundError

_PROFILE = {
    "name": "shop",
    "host": "db.example.com",
    "port": 5432,
    "database": "shop",
    "username": "readonly",
    "password": "s3cret",
    "sslmode": "require",
    "schemas": ["public"],
}

_COLUMNS = ["id", "email", "created_at"]


# --- build_select (pure SQL assembly) ------------------------------------------------


def _render(query: RowQuery) -> tuple[str, list[object]]:
    statement, params = build_select("public", "users", _COLUMNS, query)
    return statement.as_string(None), params


def test_build_select_plain_page_requests_one_extra_row() -> None:
    sql, params = _render(RowQuery(limit=100, offset=0))

    assert 'SELECT * FROM "public"."users"' in sql
    assert "WHERE" not in sql
    assert "ORDER BY" not in sql
    assert sql.strip().endswith("LIMIT %s OFFSET %s")
    # One more than the limit is asked for, so the caller can detect a further page.
    assert params == [101, 0]


def test_build_select_applies_sort_with_quoted_column() -> None:
    sql, params = _render(
        RowQuery(limit=25, offset=50, sort=SortOrder("created_at", SortDirection.DESC))
    )

    assert 'ORDER BY "created_at" DESC' in sql
    assert params == [26, 50]


def test_build_select_filters_are_parameterised() -> None:
    sql, params = _render(
        RowQuery(
            limit=100,
            offset=0,
            filters=(
                ColumnFilter("email", FilterOperator.CONTAINS, "acme"),
                ColumnFilter("id", FilterOperator.EQ, "7"),
                ColumnFilter("created_at", FilterOperator.IS_NOT_NULL),
            ),
        )
    )

    assert '"email"::text ILIKE' in sql
    assert '"id"::text =' in sql
    assert '"created_at" IS NOT NULL' in sql
    assert " AND " in sql
    # Values are bound as parameters, never interpolated; CONTAINS wraps with wildcards.
    assert params == ["%acme%", "7", 101, 0]


def test_build_select_rejects_unknown_filter_column() -> None:
    bad = RowQuery(limit=100, offset=0, filters=(ColumnFilter("secret", FilterOperator.EQ, "x"),))
    with pytest.raises(InvalidQueryError):
        build_select("public", "users", _COLUMNS, bad)


def test_build_select_rejects_unknown_sort_column() -> None:
    with pytest.raises(InvalidQueryError):
        build_select(
            "public",
            "users",
            _COLUMNS,
            RowQuery(limit=100, offset=0, sort=SortOrder("secret", SortDirection.ASC)),
        )


# --- endpoint ------------------------------------------------------------------------


class FakeDataReader:
    """Returns a canned page and records how it was called."""

    def __init__(self, page: RowPage | None = None, error: Exception | None = None) -> None:
        self._page = page
        self._error = error
        self.calls: list[tuple[ConnectionParams, tuple[str, ...], str, RowQuery]] = []

    def read_rows(
        self,
        params: ConnectionParams,
        schemas: Sequence[str],
        object_id: str,
        query: RowQuery,
    ) -> RowPage:
        self.calls.append((params, tuple(schemas), object_id, query))
        if self._error is not None:
            raise self._error
        assert self._page is not None
        return self._page


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


_PAGE = RowPage(
    columns=("id", "email"),
    rows=((1, "a@example.com"), (2, None)),
    has_more=True,
    offset=0,
    limit=2,
)


def _client(reader: FakeDataReader) -> TestClient:
    app = create_app()
    secrets = FakeSecretStore()
    app.dependency_overrides[get_data_reader] = lambda: reader
    app.dependency_overrides[get_secret_store] = lambda: secrets
    return TestClient(app)


def test_read_rows_returns_page_and_forwards_query() -> None:
    reader = FakeDataReader(_PAGE)
    with _client(reader) as client:
        created = client.post("/api/profiles", json=_PROFILE).json()
        response = client.post(
            f"/api/profiles/{created['id']}/objects/public.users/rows",
            json={
                "limit": 2,
                "offset": 0,
                "sort": {"column": "id", "direction": "desc"},
                "filters": [{"column": "email", "operator": "contains", "value": "acme"}],
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["columns"] == ["id", "email"]
    assert body["rows"] == [[1, "a@example.com"], [2, None]]
    assert body["has_more"] is True
    # The password, schemas, object id and translated query reached the reader.
    params, schemas, object_id, query = reader.calls[0]
    assert params.password == "s3cret"
    assert schemas == ("public",)
    assert object_id == "public.users"
    assert query.sort == SortOrder("id", SortDirection.DESC)
    assert query.filters == (ColumnFilter("email", FilterOperator.CONTAINS, "acme"),)


def test_read_rows_defaults_to_first_hundred_rows() -> None:
    reader = FakeDataReader(_PAGE)
    with _client(reader) as client:
        created = client.post("/api/profiles", json=_PROFILE).json()
        client.post(f"/api/profiles/{created['id']}/objects/public.users/rows", json={})

    _, _, _, query = reader.calls[0]
    assert query.limit == 100
    assert query.offset == 0
    assert query.sort is None
    assert query.filters == ()


def test_read_rows_missing_profile_returns_404() -> None:
    reader = FakeDataReader(_PAGE)
    with _client(reader) as client:
        response = client.post("/api/profiles/does-not-exist/objects/public.users/rows", json={})

    assert response.status_code == 404
    assert reader.calls == []


def test_read_rows_unknown_object_returns_404() -> None:
    reader = FakeDataReader(error=ObjectNotFoundError())
    with _client(reader) as client:
        created = client.post("/api/profiles", json=_PROFILE).json()
        response = client.post(f"/api/profiles/{created['id']}/objects/public.ghost/rows", json={})

    assert response.status_code == 404


def test_read_rows_rejects_limit_over_cap() -> None:
    reader = FakeDataReader(_PAGE)
    with _client(reader) as client:
        created = client.post("/api/profiles", json=_PROFILE).json()
        response = client.post(
            f"/api/profiles/{created['id']}/objects/public.users/rows",
            json={"limit": 5000},
        )

    assert response.status_code == 422
    assert reader.calls == []
