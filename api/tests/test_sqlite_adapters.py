"""Tests for the SQLite adapters — inspection, row preview, and the read-only guarantee.

SQLite runs in-process, so these build a real throwaway database file and drive the actual
adapters against it: fast, yet proving the SQL and PRAGMA queries behave, not just that a
fake returns what it was told to. The pure ``build_graph`` and ``build_select`` helpers are
also exercised directly, without any connection.
"""

import sqlite3
from pathlib import Path

import pytest

from shirube.adapters.sqlite._common import read_only_connection
from shirube.adapters.sqlite.connector import SqliteConnector
from shirube.adapters.sqlite.data_reader import SqliteDataReader, build_select
from shirube.adapters.sqlite.schema_inspector import (
    SQLITE_SCHEMA,
    SqliteSchemaInspector,
    build_graph,
)
from shirube.application.connection_params import build_connection_params
from shirube.domain.connection import (
    ConnectionProfile,
    SqliteConnectionParams,
    SqliteTarget,
)
from shirube.domain.data import ColumnFilter, FilterOperator, RowQuery, SortDirection, SortOrder
from shirube.domain.errors import ConnectionFailedError, InvalidQueryError, ObjectNotFoundError
from shirube.domain.schema import ObjectKind, RelationshipKind


@pytest.fixture
def chinook_like(tmp_path: Path) -> SqliteConnectionParams:
    """A small database with a foreign key, a view, and a quoting-hostile table.

    ``artist`` ← ``album`` gives one foreign key to draw; ``album_view`` a view node; and the
    ``we"ird`` table a name and columns that need quoting.
    """
    path = tmp_path / "sample.sqlite"
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE artist (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL
        );
        CREATE TABLE album (
            id INTEGER PRIMARY KEY,
            title TEXT,
            artist_id INTEGER REFERENCES artist(id)
        );
        CREATE VIEW album_view AS SELECT id, title FROM album;
        INSERT INTO artist (id, name) VALUES (1, 'Queen'), (2, 'Bowie');
        INSERT INTO album (id, title, artist_id) VALUES
            (1, 'A Night at the Opera', 1),
            (2, 'Hunky Dory', 2),
            (3, 'Untitled', NULL);
        CREATE TABLE "we""ird" (id INTEGER PRIMARY KEY, "select" TEXT, "a b" TEXT);
        INSERT INTO "we""ird" (id, "select", "a b") VALUES (1, 'reserved', 'spaced');
        """
    )
    connection.commit()
    connection.close()
    return SqliteConnectionParams(path=str(path))


# --- schema inspection ---------------------------------------------------------------


def test_inspect_reads_objects_columns_and_the_foreign_key(
    chinook_like: SqliteConnectionParams,
) -> None:
    graph = SqliteSchemaInspector().inspect(chinook_like, schemas=())

    objects = {obj.id: obj for obj in graph.objects}
    # Tables and the view appear, all under the single ``main`` namespace.
    assert set(objects) == {
        f"{SQLITE_SCHEMA}.artist",
        f"{SQLITE_SCHEMA}.album",
        f"{SQLITE_SCHEMA}.album_view",
        f'{SQLITE_SCHEMA}.we"ird',
    }
    assert objects[f"{SQLITE_SCHEMA}.album_view"].kind is ObjectKind.VIEW
    assert objects[f"{SQLITE_SCHEMA}.artist"].kind is ObjectKind.TABLE

    # Columns carry primary-key and nullability, read straight from PRAGMA table_info.
    artist = objects[f"{SQLITE_SCHEMA}.artist"]
    id_column = next(column for column in artist.columns if column.name == "id")
    name_column = next(column for column in artist.columns if column.name == "name")
    assert id_column.is_primary_key is True
    assert name_column.nullable is False

    # The single foreign key album.artist_id → artist.id is drawn, source to target.
    assert len(graph.relationships) == 1
    edge = graph.relationships[0]
    assert edge.kind is RelationshipKind.FOREIGN_KEY
    assert edge.source == f"{SQLITE_SCHEMA}.album"
    assert edge.target == f"{SQLITE_SCHEMA}.artist"
    assert edge.source_columns == ("artist_id",)
    assert edge.target_columns == ("id",)


def test_inspect_ignores_sqlite_internal_tables(chinook_like: SqliteConnectionParams) -> None:
    graph = SqliteSchemaInspector().inspect(chinook_like, schemas=())
    assert not any("sqlite_" in obj.name for obj in graph.objects)


def test_build_graph_drops_a_foreign_key_to_an_absent_table() -> None:
    """A key whose target is not among the loaded objects is not drawn as an edge to nowhere."""
    graph = build_graph(
        object_rows=[{"name": "album", "type": "table"}],
        column_rows=[
            {"table": "album", "name": "artist_id", "data_type": "INTEGER", "not_null": 0, "pk": 0}
        ],
        foreign_key_rows=[
            {
                "source_table": "album",
                "id": 0,
                "target_table": "artist",
                "from_column": "artist_id",
                "to_column": "id",
            }
        ],
    )
    assert graph.relationships == ()


def test_build_graph_folds_a_composite_key_into_one_edge() -> None:
    """Two rows sharing an id become a single edge with ordered column tuples."""
    graph = build_graph(
        object_rows=[
            {"name": "child", "type": "table"},
            {"name": "parent", "type": "table"},
        ],
        column_rows=[],
        foreign_key_rows=[
            {
                "source_table": "child",
                "id": 0,
                "target_table": "parent",
                "from_column": "a",
                "to_column": "x",
            },
            {
                "source_table": "child",
                "id": 0,
                "target_table": "parent",
                "from_column": "b",
                "to_column": "y",
            },
        ],
    )
    assert len(graph.relationships) == 1
    edge = graph.relationships[0]
    assert edge.source_columns == ("a", "b")
    assert edge.target_columns == ("x", "y")


# --- row preview ---------------------------------------------------------------------


def test_read_rows_returns_a_page(chinook_like: SqliteConnectionParams) -> None:
    page = SqliteDataReader().read_rows(
        chinook_like,
        schemas=(),
        object_id=f"{SQLITE_SCHEMA}.album",
        query=RowQuery(limit=2, offset=0),
    )
    assert page.columns == ("id", "title", "artist_id")
    assert len(page.rows) == 2
    # A third row exists past the page of two.
    assert page.has_more is True


def test_read_rows_filters_and_sorts(chinook_like: SqliteConnectionParams) -> None:
    page = SqliteDataReader().read_rows(
        chinook_like,
        schemas=(),
        object_id=f"{SQLITE_SCHEMA}.artist",
        query=RowQuery(
            limit=10,
            offset=0,
            sort=SortOrder(column="name"),
            filters=(ColumnFilter(column="name", operator=FilterOperator.CONTAINS, value="e"),),
        ),
    )
    # Both 'Queen' and 'Bowie' contain an 'e', ordered ascending by name.
    names = [row[page.columns.index("name")] for row in page.rows]
    assert names == ["Bowie", "Queen"]


def test_read_rows_pages_stably_by_the_primary_key(
    chinook_like: SqliteConnectionParams,
) -> None:
    """Consecutive pages are contiguous and never overlap, because paging orders by the key."""
    reader = SqliteDataReader()

    def ids(offset: int) -> list[object]:
        page = reader.read_rows(
            chinook_like,
            schemas=(),
            object_id=f"{SQLITE_SCHEMA}.album",
            query=RowQuery(limit=2, offset=offset),
        )
        return [row[page.columns.index("id")] for row in page.rows]

    first, second = ids(0), ids(2)
    # Ordered by the primary key: each page is sorted, they do not overlap, and together they
    # form the full, gap-free sequence — the guarantee OFFSET paging needs.
    assert first == sorted(first)
    assert set(first).isdisjoint(second)
    assert first + second == sorted(first + second)


def test_read_rows_reads_a_view_without_a_stable_key(
    chinook_like: SqliteConnectionParams,
) -> None:
    """A view has no primary key or rowid; it is still read (best-effort order), not rejected."""
    page = SqliteDataReader().read_rows(
        chinook_like,
        schemas=(),
        object_id=f"{SQLITE_SCHEMA}.album_view",
        query=RowQuery(limit=10, offset=0),
    )
    assert page.columns == ("id", "title")
    assert len(page.rows) == 3


def test_read_rows_handles_quoting_hostile_identifiers(
    chinook_like: SqliteConnectionParams,
) -> None:
    """A table and columns whose names need quoting are read without error."""
    page = SqliteDataReader().read_rows(
        chinook_like,
        schemas=(),
        object_id=f'{SQLITE_SCHEMA}.we"ird',
        query=RowQuery(
            limit=10,
            offset=0,
            filters=(ColumnFilter(column="select", operator=FilterOperator.EQ, value="reserved"),),
        ),
    )
    assert len(page.rows) == 1


def test_read_rows_unknown_object_is_not_found(chinook_like: SqliteConnectionParams) -> None:
    with pytest.raises(ObjectNotFoundError):
        SqliteDataReader().read_rows(
            chinook_like,
            schemas=(),
            object_id=f"{SQLITE_SCHEMA}.ghost",
            query=RowQuery(limit=10, offset=0),
        )


def test_read_rows_rejects_a_wrong_schema_prefix(chinook_like: SqliteConnectionParams) -> None:
    """An object id outside the single ``main`` namespace cannot resolve."""
    with pytest.raises(ObjectNotFoundError):
        SqliteDataReader().read_rows(
            chinook_like,
            schemas=(),
            object_id="public.album",
            query=RowQuery(limit=10, offset=0),
        )


def _album_titles(chinook_like: SqliteConnectionParams, query: RowQuery) -> list[object]:
    """Read ``album`` with the given query and return its title column."""
    page = SqliteDataReader().read_rows(
        chinook_like,
        schemas=(),
        object_id=f"{SQLITE_SCHEMA}.album",
        query=query,
    )
    return [row[page.columns.index("title")] for row in page.rows]


def test_read_rows_is_null_and_is_not_null(chinook_like: SqliteConnectionParams) -> None:
    """The null checks partition the rows by a nullable column (album 3 has no artist)."""
    absent = _album_titles(
        chinook_like,
        RowQuery(
            limit=10,
            offset=0,
            filters=(ColumnFilter(column="artist_id", operator=FilterOperator.IS_NULL),),
        ),
    )
    present = _album_titles(
        chinook_like,
        RowQuery(
            limit=10,
            offset=0,
            filters=(ColumnFilter(column="artist_id", operator=FilterOperator.IS_NOT_NULL),),
        ),
    )
    assert absent == ["Untitled"]
    assert set(present) == {"A Night at the Opera", "Hunky Dory"}


def test_read_rows_not_equal_filter(chinook_like: SqliteConnectionParams) -> None:
    """The ``ne`` operator excludes the matching value, comparing as text."""
    titles = _album_titles(
        chinook_like,
        RowQuery(
            limit=10,
            offset=0,
            filters=(ColumnFilter(column="title", operator=FilterOperator.NE, value="Hunky Dory"),),
        ),
    )
    assert "Hunky Dory" not in titles
    assert set(titles) == {"A Night at the Opera", "Untitled"}


def test_read_rows_reports_no_more_when_the_page_holds_every_row(
    chinook_like: SqliteConnectionParams,
) -> None:
    """A limit larger than the table means the last page, so ``has_more`` is false."""
    page = SqliteDataReader().read_rows(
        chinook_like,
        schemas=(),
        object_id=f"{SQLITE_SCHEMA}.album",
        query=RowQuery(limit=10, offset=0),
    )
    assert len(page.rows) == 3
    assert page.has_more is False


def test_read_rows_reduces_blob_and_null_cells(tmp_path: Path) -> None:
    """A BLOB becomes a size placeholder and NULL passes through as ``None``."""
    path = tmp_path / "blobs.sqlite"
    connection = sqlite3.connect(path)
    connection.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, data BLOB, note TEXT)")
    connection.execute("INSERT INTO items (id, data, note) VALUES (1, ?, NULL)", (b"\x00\x01\x02",))
    connection.commit()
    connection.close()

    page = SqliteDataReader().read_rows(
        SqliteConnectionParams(path=str(path)),
        schemas=(),
        object_id=f"{SQLITE_SCHEMA}.items",
        query=RowQuery(limit=10, offset=0),
    )
    row = page.rows[0]
    assert row[page.columns.index("data")] == "[3 bytes]"
    assert row[page.columns.index("note")] is None


def test_build_select_quotes_identifiers_and_binds_values() -> None:
    statement, params = build_select(
        name='we"ird',
        columns=["id", "select"],
        query=RowQuery(
            limit=5,
            offset=0,
            sort=SortOrder(column="select"),
            filters=(ColumnFilter(column="select", operator=FilterOperator.CONTAINS, value="x"),),
        ),
    )
    # The embedded quote is doubled, and no filter value is interpolated into the text.
    assert 'FROM "we""ird"' in statement
    assert "x" not in statement
    assert params == ["%x%", 6, 0]


def test_build_select_orders_by_the_primary_key_when_unsorted() -> None:
    statement, _ = build_select(
        name="album", columns=["id", "title"], query=RowQuery(limit=5, offset=0), order_key=["id"]
    )

    assert 'ORDER BY "id" ASC' in statement


def test_build_select_appends_the_primary_key_as_a_tiebreaker() -> None:
    statement, _ = build_select(
        name="album",
        columns=["id", "title"],
        query=RowQuery(
            limit=5, offset=0, sort=SortOrder(column="title", direction=SortDirection.DESC)
        ),
        order_key=["id"],
    )

    assert 'ORDER BY "title" DESC, "id" ASC' in statement


def test_build_select_falls_back_to_rowid_for_a_keyless_table() -> None:
    # A rowid table without a declared primary key still pages stably by its implicit rowid,
    # written bare (never quoted, which SQLite would read as a string literal).
    statement, _ = build_select(
        name="log", columns=["message"], query=RowQuery(limit=5, offset=0), rowid_fallback=True
    )

    assert "ORDER BY rowid ASC" in statement
    assert '"rowid"' not in statement


def test_build_select_leaves_a_view_unordered_when_no_stable_key_exists() -> None:
    # No primary key and not a rowid table (e.g. a view): no stable order can be formed.
    statement, _ = build_select(
        name="v_summary", columns=["message"], query=RowQuery(limit=5, offset=0)
    )

    assert "ORDER BY" not in statement


def test_build_select_rejects_an_unknown_filter_column() -> None:
    """A filter on a column the object lacks is refused before any SQL runs."""
    with pytest.raises(InvalidQueryError):
        build_select(
            name="album",
            columns=["id", "title"],
            query=RowQuery(
                limit=5,
                offset=0,
                filters=(ColumnFilter(column="ghost", operator=FilterOperator.EQ, value="x"),),
            ),
        )


def test_build_select_rejects_an_unknown_sort_column() -> None:
    """A sort on a column the object lacks is refused before any SQL runs."""
    with pytest.raises(InvalidQueryError):
        build_select(
            name="album",
            columns=["id", "title"],
            query=RowQuery(limit=5, offset=0, sort=SortOrder(column="ghost")),
        )


# --- the read-only guarantee ---------------------------------------------------------


def test_connector_opens_read_only(chinook_like: SqliteConnectionParams) -> None:
    """A successful test connection does not raise."""
    SqliteConnector().test_connection(chinook_like)


def test_writes_are_refused(chinook_like: SqliteConnectionParams) -> None:
    """The read-only open means even an explicit write is rejected by SQLite itself."""
    with pytest.raises(ConnectionFailedError):
        with read_only_connection(chinook_like) as connection:
            connection.execute("INSERT INTO artist (id, name) VALUES (99, 'hacker')")


class _NoSecrets:
    """A secret store that must not be consulted — SQLite has no password."""

    def get_password(self, profile_id: str) -> str | None:
        raise AssertionError("a SQLite connection must not read the keychain")

    def set_password(self, profile_id: str, password: str) -> None: ...

    def delete_password(self, profile_id: str) -> None: ...


def test_build_connection_params_for_a_sqlite_profile_skips_the_keychain() -> None:
    """A SQLite profile becomes file parameters without ever touching the secret store."""
    profile = ConnectionProfile(
        id="s1",
        name="chinook",
        target=SqliteTarget(path="/data/chinook.sqlite"),
    )

    params = build_connection_params(profile, _NoSecrets())

    assert params == SqliteConnectionParams(path="/data/chinook.sqlite")


def test_missing_file_is_a_friendly_error(tmp_path: Path) -> None:
    params = SqliteConnectionParams(path=str(tmp_path / "does-not-exist.sqlite"))
    with pytest.raises(ConnectionFailedError) as exc_info:
        SqliteConnector().test_connection(params)
    assert "does-not-exist.sqlite" in exc_info.value.detail


def test_a_non_database_file_is_a_friendly_error(tmp_path: Path) -> None:
    junk = tmp_path / "notes.txt"
    junk.write_text("this is not a database")
    params = SqliteConnectionParams(path=str(junk))
    with pytest.raises(ConnectionFailedError) as exc_info:
        # Opening succeeds lazily; the first real query is where SQLite rejects the file.
        with read_only_connection(params) as connection:
            connection.execute("SELECT name FROM sqlite_master").fetchall()
    assert "not a SQLite database" in exc_info.value.detail
