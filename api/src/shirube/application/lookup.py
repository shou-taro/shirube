"""The AI navigator's schema look-up tools (Milestone 2 — AI navigator).

A small, fixed set of read-only, **metadata-only** look-ups over an already-introspected
:class:`~shirube.domain.schema.SchemaGraph` — the same graph the ER map draws, so the AI
sees exactly what the map sees. The navigator is handed these as tools and pulls in only
what a question needs, rather than the whole schema (which would blow the context window on
a large database).

This module is pure: given a graph, it answers all four look-ups with no I/O and no
database hit. A provider adapter (a later milestone) constructs one
:class:`SchemaLookup` per chat turn from a freshly-introspected graph and exposes its
methods as the model's tools.

The tools **never return row data or column values** — only names, types, keys,
nullability, comments, relationship structure and catalogue count *estimates*. That
metadata-only guarantee is what keeps the navigator "never dangerous": it proposes; a
human clicks through to the data preview to see real rows.
"""

from collections import deque

from shirube.domain.lookup import (
    ObjectDetail,
    ObjectHit,
    PathResult,
    RelationshipRef,
    SchemaSummary,
)
from shirube.domain.schema import SchemaGraph, SchemaObject

# Default number of matches returned by ``search_objects`` — mirrors the web ⌘K search's
# ``MAX_RESULTS`` so the AI's entry point and the human's agree.
DEFAULT_SEARCH_LIMIT = 8

# Rank given to a column-name match: below every object-name match (0/1/2), so a table
# found by its own name always outranks one found only by a column it contains.
_COLUMN_MATCH_RANK = 3


def _name_rank(name: str, query: str) -> int | None:
    """Relevance rank of an object name against a lower-cased query; ``None`` if no match.

    Mirrors the web search's ``nameRank`` (``schema-search.tsx``) so both surfaces order
    hits identically: an exact name beats a prefix, which beats a mere substring — so
    searching ``store`` surfaces the ``store`` table above ``sales_by_store``.
    """
    lowered = name.lower()
    if lowered == query:
        return 0  # exact
    if lowered.startswith(query):
        return 1  # prefix
    if query in lowered:
        return 2  # substring
    return None


class SchemaLookup:
    """Read-only, metadata-only look-ups over one introspected schema graph.

    Construct from the graph built at connect; every method answers from memory, with no
    further database access.
    """

    def __init__(self, graph: SchemaGraph) -> None:
        self._graph = graph
        self._by_id: dict[str, SchemaObject] = {obj.id: obj for obj in graph.objects}
        # Undirected adjacency for path finding: a relationship is a connection regardless
        # of which way its arrow points ("how are these related", not "which references
        # which"). Both foreign keys and view dependencies count as edges.
        self._neighbours: dict[str, set[str]] = {obj.id: set() for obj in graph.objects}
        for rel in graph.relationships:
            if rel.source in self._neighbours and rel.target in self._neighbours:
                self._neighbours[rel.source].add(rel.target)
                self._neighbours[rel.target].add(rel.source)

    def search_objects(self, query: str, limit: int = DEFAULT_SEARCH_LIMIT) -> list[ObjectHit]:
        """Return objects matching ``query``, ranked by relevance.

        Objects are matched by name first (exact → prefix → substring), then, for objects
        that did not match by name, by a column name — so "where does customer_id live?"
        leads somewhere. Every name match ranks above every column match, ties break
        alphabetically by id, and each object appears at most once.

        Args:
            query: The search text; leading/trailing space is ignored and matching is
                case-insensitive. An empty query returns no hits.
            limit: The maximum number of hits to return.

        Returns:
            Up to ``limit`` ranked hits, best first (metadata only — no row data).
        """
        normalised = query.strip().lower()
        if normalised == "" or limit <= 0:
            return []

        ranked: list[tuple[int, str, ObjectHit]] = []
        for obj in self._graph.objects:
            rank = _name_rank(obj.name, normalised)
            if rank is not None:
                ranked.append((rank, obj.id, self._to_hit(obj)))
                continue
            # No name match — fall back to the first column whose name matches.
            column = next(
                (c for c in obj.columns if normalised in c.name.lower()),
                None,
            )
            if column is not None:
                ranked.append((_COLUMN_MATCH_RANK, obj.id, self._to_hit(obj, column.name)))

        ranked.sort(key=lambda entry: (entry[0], entry[1]))
        return [hit for _, _, hit in ranked[:limit]]

    def get_object(self, ref: str) -> ObjectDetail | None:
        """Return one object's full metadata, or ``None`` if no such object exists.

        Relationships are split by direction relative to ``ref``: ``references`` are the
        objects it points at (outgoing foreign keys, and the relations a view reads);
        ``referenced_by`` are the objects that point at it. Each carries the joined
        columns — but never any values.

        Args:
            ref: The ``schema.name`` id of the object to describe.

        Returns:
            The object's detail, or ``None`` when ``ref`` is unknown.
        """
        obj = self._by_id.get(ref)
        if obj is None:
            return None

        references = [
            RelationshipRef(
                constraint_name=rel.constraint_name,
                related=rel.target,
                kind=rel.kind,
                columns=rel.source_columns,
                related_columns=rel.target_columns,
            )
            for rel in self._graph.relationships
            if rel.source == ref
        ]
        referenced_by = [
            RelationshipRef(
                constraint_name=rel.constraint_name,
                related=rel.source,
                kind=rel.kind,
                # From this object's view it is the target, so its own columns are the
                # relationship's target columns.
                columns=rel.target_columns,
                related_columns=rel.source_columns,
            )
            for rel in self._graph.relationships
            if rel.target == ref
        ]
        references.sort(key=lambda r: (r.related, r.constraint_name))
        referenced_by.sort(key=lambda r: (r.related, r.constraint_name))

        return ObjectDetail(
            id=obj.id,
            schema=obj.schema,
            name=obj.name,
            kind=obj.kind,
            row_estimate=obj.row_estimate,
            columns=obj.columns,
            references=tuple(references),
            referenced_by=tuple(referenced_by),
        )

    def find_path(self, source: str, target: str) -> PathResult | None:
        """Return the shortest relationship path between two objects.

        A breadth-first walk over the relationship graph, treating edges as undirected —
        one cheap, deterministic call answers "how are these related" instead of many
        ``get_object`` hops. When several shortest paths exist, neighbours are visited in
        id order so the result is stable.

        Args:
            source: The ``schema.name`` id to start from.
            target: The ``schema.name`` id to reach.

        Returns:
            A :class:`PathResult` whose ``hops`` run source → target inclusive
            (``(source,)`` when they are the same object; empty when unreachable), or
            ``None`` if either endpoint is unknown.
        """
        if source not in self._by_id or target not in self._by_id:
            return None
        if source == target:
            return PathResult((source,))

        # BFS, tracking each node's predecessor so the path can be reconstructed.
        predecessor: dict[str, str] = {source: source}
        queue: deque[str] = deque([source])
        while queue:
            current = queue.popleft()
            for neighbour in sorted(self._neighbours[current]):
                if neighbour in predecessor:
                    continue
                predecessor[neighbour] = current
                if neighbour == target:
                    return PathResult(self._reconstruct(predecessor, source, target))
                queue.append(neighbour)

        return PathResult(())

    def list_schemas(self) -> list[SchemaSummary]:
        """Return each schema with its object count, ordered by schema name.

        Cheap orientation on a multi-schema database.

        Returns:
            One summary per schema present in the graph.
        """
        counts: dict[str, int] = {}
        for obj in self._graph.objects:
            counts[obj.schema] = counts.get(obj.schema, 0) + 1
        return [SchemaSummary(schema=name, object_count=counts[name]) for name in sorted(counts)]

    @staticmethod
    def _to_hit(obj: SchemaObject, matched_column: str | None = None) -> ObjectHit:
        """Build a search hit from an object (metadata only — no values)."""
        return ObjectHit(
            id=obj.id,
            schema=obj.schema,
            name=obj.name,
            kind=obj.kind,
            column_count=len(obj.columns),
            row_estimate=obj.row_estimate,
            matched_column=matched_column,
        )

    @staticmethod
    def _reconstruct(predecessor: dict[str, str], source: str, target: str) -> tuple[str, ...]:
        """Walk predecessors back from ``target`` to ``source`` and return the forward path."""
        path = [target]
        while path[-1] != source:
            path.append(predecessor[path[-1]])
        path.reverse()
        return tuple(path)
