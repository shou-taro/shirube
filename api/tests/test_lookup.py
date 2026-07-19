"""Tests for the AI navigator's schema look-up tools.

The look-ups are pure functions over a hand-built :class:`SchemaGraph`, so they need no
database — the graph stands in for one introspected at connect. Ranking is checked for
parity with the web ⌘K search, and every result is checked to carry metadata only, never
row values.
"""

from dataclasses import fields, is_dataclass

from shirube.application.lookup import SchemaLookup
from shirube.domain.lookup import ObjectDetail, ObjectHit
from shirube.domain.schema import (
    Column,
    ObjectKind,
    Relationship,
    RelationshipKind,
    SchemaGraph,
    SchemaObject,
)


def _table(
    schema: str,
    name: str,
    *columns: Column,
    row_estimate: int | None = None,
) -> SchemaObject:
    return SchemaObject(
        schema=schema,
        name=name,
        kind=ObjectKind.TABLE,
        columns=columns,
        row_estimate=row_estimate,
    )


# A small shop schema: store ← staff → address, with a sales_by_store view over store, plus
# an unrelated "audit" table in a second schema for list_schemas / find_path coverage.
_STORE = _table(
    "public",
    "store",
    Column("store_id", "integer", nullable=False, is_primary_key=True),
    Column("address_id", "integer", nullable=False),
    row_estimate=2,
)
_STAFF = _table(
    "public",
    "staff",
    Column("staff_id", "integer", nullable=False, is_primary_key=True),
    Column("store_id", "integer", nullable=False),
    Column("address_id", "integer", nullable=True),
    row_estimate=10,
)
_ADDRESS = _table(
    "public",
    "address",
    Column("address_id", "integer", nullable=False, is_primary_key=True, comment="the address key"),
    row_estimate=100,
)
_SALES_BY_STORE = SchemaObject(
    schema="public",
    name="sales_by_store",
    kind=ObjectKind.VIEW,
    columns=(Column("store_id", "integer", nullable=True),),
)
_AUDIT = _table("ops", "audit", Column("id", "integer", nullable=False, is_primary_key=True))

_STAFF_STORE_FK = Relationship(
    constraint_name="staff_store_id_fkey",
    source="public.staff",
    source_columns=("store_id",),
    target="public.store",
    target_columns=("store_id",),
)
_STAFF_ADDRESS_FK = Relationship(
    constraint_name="staff_address_id_fkey",
    source="public.staff",
    source_columns=("address_id",),
    target="public.address",
    target_columns=("address_id",),
)
_STORE_ADDRESS_FK = Relationship(
    constraint_name="store_address_id_fkey",
    source="public.store",
    source_columns=("address_id",),
    target="public.address",
    target_columns=("address_id",),
)
_SALES_VIEW_DEP = Relationship(
    constraint_name="public.sales_by_store->public.store",
    source="public.sales_by_store",
    source_columns=(),
    target="public.store",
    target_columns=(),
    kind=RelationshipKind.VIEW_DEPENDENCY,
)

_GRAPH = SchemaGraph(
    objects=(_ADDRESS, _SALES_BY_STORE, _STAFF, _STORE, _AUDIT),
    relationships=(_STAFF_STORE_FK, _STAFF_ADDRESS_FK, _STORE_ADDRESS_FK, _SALES_VIEW_DEP),
)


def _lookup() -> SchemaLookup:
    return SchemaLookup(_GRAPH)


# --- search_objects ------------------------------------------------------------------


def test_search_ranks_exact_name_above_longer_partial() -> None:
    # "store" is an exact match for `store` but only a substring of `sales_by_store`, so
    # the exact match must lead — the very bug fixed in 0.1.0b3, now guarded on the backend.
    hits = _lookup().search_objects("store")
    ids = [hit.id for hit in hits]

    assert ids[0] == "public.store"
    assert "public.sales_by_store" in ids
    assert ids.index("public.store") < ids.index("public.sales_by_store")


def test_search_prefix_beats_substring() -> None:
    graph = SchemaGraph(
        objects=(
            _table("public", "order_line", Column("id", "integer", nullable=False)),
            _table("public", "backorder", Column("id", "integer", nullable=False)),
        )
    )
    hits = SchemaLookup(graph).search_objects("order")

    # `order_line` starts with the query (prefix, rank 1); `backorder` only contains it
    # (substring, rank 2).
    assert [hit.name for hit in hits] == ["order_line", "backorder"]


def test_search_name_match_outranks_column_match() -> None:
    # "address" is the name of the `address` table and also a column on store/staff. The
    # named table must come first; column-only hits rank last.
    hits = _lookup().search_objects("address")
    ids = [hit.id for hit in hits]

    assert ids[0] == "public.address"
    # store and staff match only via their address_id column.
    store_hit = next(hit for hit in hits if hit.id == "public.store")
    assert store_hit.matched_column == "address_id"
    assert ids.index("public.address") < ids.index("public.store")


def test_search_hit_carries_cheap_signals_only() -> None:
    hit = next(h for h in _lookup().search_objects("staff") if h.id == "public.staff")

    assert hit.kind is ObjectKind.TABLE
    assert hit.column_count == 3
    assert hit.row_estimate == 10
    assert hit.matched_column is None  # matched by name, not a column


def test_search_empty_query_and_limit() -> None:
    lookup = _lookup()
    assert lookup.search_objects("   ") == []
    assert lookup.search_objects("a", limit=0) == []
    assert len(lookup.search_objects("a", limit=1)) == 1


# --- get_object ----------------------------------------------------------------------


def test_get_object_splits_references_and_referenced_by() -> None:
    detail = _lookup().get_object("public.store")
    assert detail is not None

    # store → address (its own FK), and store is referenced by staff (FK) and the view.
    assert [r.related for r in detail.references] == ["public.address"]
    assert detail.references[0].kind is RelationshipKind.FOREIGN_KEY
    assert detail.references[0].columns == ("address_id",)
    assert detail.references[0].related_columns == ("address_id",)

    referenced = {(r.related, r.kind) for r in detail.referenced_by}
    assert ("public.staff", RelationshipKind.FOREIGN_KEY) in referenced
    assert ("public.sales_by_store", RelationshipKind.VIEW_DEPENDENCY) in referenced


def test_get_object_referenced_by_uses_this_objects_columns() -> None:
    # address is pointed at by store and staff; from address's side the joined column is
    # its own address_id, and the related columns are the referencing tables' columns.
    detail = _lookup().get_object("public.address")
    assert detail is not None

    staff_ref = next(r for r in detail.referenced_by if r.related == "public.staff")
    assert staff_ref.columns == ("address_id",)  # address's column
    assert staff_ref.related_columns == ("address_id",)  # staff's column
    # The column comment is preserved (metadata, not a value).
    assert detail.columns[0].comment == "the address key"


def test_get_object_unknown_returns_none() -> None:
    assert _lookup().get_object("public.does_not_exist") is None


# --- find_path -----------------------------------------------------------------------


def test_find_path_returns_shortest_undirected_hops() -> None:
    # staff → store is a single FK hop even though nothing points staff→store→…; edges are
    # undirected for reachability.
    result = _lookup().find_path("public.staff", "public.store")
    assert result is not None
    assert result.found
    assert result.hops == ("public.staff", "public.store")


def test_find_path_multi_hop() -> None:
    # sales_by_store depends on store, which references address: a two-hop path.
    result = _lookup().find_path("public.sales_by_store", "public.address")
    assert result is not None
    assert result.hops == ("public.sales_by_store", "public.store", "public.address")


def test_find_path_same_object() -> None:
    result = _lookup().find_path("public.store", "public.store")
    assert result is not None
    assert result.hops == ("public.store",)


def test_find_path_unreachable_is_empty_not_none() -> None:
    # The `ops.audit` table is in the graph but connects to nothing.
    result = _lookup().find_path("public.store", "ops.audit")
    assert result is not None
    assert not result.found
    assert result.hops == ()


def test_find_path_unknown_endpoint_returns_none() -> None:
    lookup = _lookup()
    assert lookup.find_path("public.store", "public.nope") is None
    assert lookup.find_path("public.nope", "public.store") is None


# --- list_schemas --------------------------------------------------------------------


def test_list_schemas_counts_objects_ordered_by_name() -> None:
    summaries = _lookup().list_schemas()

    assert [s.schema for s in summaries] == ["ops", "public"]
    counts = {s.schema: s.object_count for s in summaries}
    assert counts == {"ops": 1, "public": 4}


# --- metadata-only guarantee ---------------------------------------------------------


def _field_names(obj: object) -> set[str]:
    assert is_dataclass(obj)
    return {f.name for f in fields(obj)}


def test_results_expose_metadata_fields_only() -> None:
    """No look-up result carries a field that could hold a row value.

    The look-ups reason over schema shape only; a "value"/"data"/"rows" field would be a
    contract violation. This locks the surface so a future edit can't quietly add one.
    """
    lookup = _lookup()
    hit = lookup.search_objects("store")[0]
    detail = lookup.get_object("public.store")
    assert isinstance(hit, ObjectHit)
    assert isinstance(detail, ObjectDetail)

    forbidden = {"value", "values", "data", "rows", "row", "sample", "content"}
    for result in (hit, detail, *detail.references, *detail.columns):
        assert _field_names(result) & forbidden == set()
