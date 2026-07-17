"""Tests for row previewing.

The SQL assembly is exercised directly with sample inputs (no database needed), and the
endpoint is exercised with a fake reader standing in for the real adapter.
"""

from collections.abc import Sequence

import pytest
from fastapi.testclient import TestClient
from hypothesis import given, settings
from hypothesis import strategies as st

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


# --- build_select property tests (Hypothesis) ----------------------------------------
#
# The builder faces a wide, hostile input space, so instead of a few chosen cases these
# throw many at it and assert the two invariants that keep it safe: any unknown column is
# rejected, and a filter value never reaches the SQL text — proven by the statement being
# identical when only the values differ.

# The structure of one generated case: the column whitelist, the (column, operator) pairs
# for filters, an optional (column, direction) sort, and the page bounds.
_Case = tuple[
    list[str],
    list[tuple[str, FilterOperator]],
    tuple[str, SortDirection] | None,
    int,
    int,
]

# Deliberately awkward identifiers alongside arbitrary printable text, so both curated
# nasties and random noise are exercised.
_NASTY_IDENTIFIERS = ['"', ";", "--", "DROP TABLE x", "a b", "select", "%(x)s", "{}", "café", "id'"]
_identifiers = st.one_of(
    st.sampled_from(_NASTY_IDENTIFIERS),
    st.text(st.characters(min_codepoint=32, max_codepoint=126), min_size=1, max_size=8),
)
_VALUELESS = (FilterOperator.IS_NULL, FilterOperator.IS_NOT_NULL)


@st.composite
def _cases(draw: st.DrawFn) -> _Case:
    """Draw a column whitelist and a query that may reference columns outside it."""
    columns = draw(st.lists(_identifiers, min_size=1, max_size=5, unique=True))
    referenceable = st.one_of(st.sampled_from(columns), _identifiers)
    filters = draw(
        st.lists(st.tuples(referenceable, st.sampled_from(list(FilterOperator))), max_size=4)
    )
    sort = draw(
        st.one_of(st.none(), st.tuples(referenceable, st.sampled_from(list(SortDirection))))
    )
    limit = draw(st.integers(min_value=1, max_value=1000))
    offset = draw(st.integers(min_value=0, max_value=1000))
    return columns, filters, sort, limit, offset


def _query(case: _Case, value: str) -> RowQuery:
    """Build a RowQuery from a case, using one value for every value-bearing filter."""
    _, filters, sort, limit, offset = case
    return RowQuery(
        limit=limit,
        offset=offset,
        sort=SortOrder(sort[0], sort[1]) if sort is not None else None,
        filters=tuple(
            ColumnFilter(column, operator, None if operator in _VALUELESS else value)
            for column, operator in filters
        ),
    )


@settings(max_examples=400, deadline=None)
@given(_cases())
def test_build_select_is_injection_safe(case: _Case) -> None:
    columns, filters, sort, limit, offset = case
    known = set(columns)
    references_unknown = any(column not in known for column, _ in filters) or (
        sort is not None and sort[0] not in known
    )

    if references_unknown:
        with pytest.raises(InvalidQueryError):
            build_select("public", "t", columns, _query(case, "alpha"))
        return

    statement_a, params_a = build_select("public", "t", columns, _query(case, "ALPHA_VALUE"))
    statement_b, _ = build_select("public", "t", columns, _query(case, 'B;--"DROP'))

    # Values are bound, never inlined: the SQL text is identical when only values change.
    assert statement_a.as_string(None) == statement_b.as_string(None)
    # Each value reaches the parameter list (wrapped for CONTAINS), then the page bounds.
    expected_values = [
        "%ALPHA_VALUE%" if operator is FilterOperator.CONTAINS else "ALPHA_VALUE"
        for _, operator in filters
        if operator not in _VALUELESS
    ]
    assert params_a == [*expected_values, limit + 1, offset]


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
