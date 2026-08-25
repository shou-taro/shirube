"""Generate the demo's static Chinook fixtures (schema + a sample of rows).

Introspects the bundled Chinook SQLite sample with shirube's own SQLite inspector and
serialises it with the API's response model, so the schema JSON is byte-for-byte what the
real `/schema` endpoint returns — the demo feeds it straight to the real ER map with no
backend. A small page of real rows per table is dumped too, so the data preview works in
the demo. Output lands in `web/src/demo/`, where the demo build reads it. Run from the
repo root:

    uv run --directory api python ../site/scripts/gen-chinook-fixture.py
"""

import json
import sqlite3
from importlib import resources
from pathlib import Path

from shirube.adapters.api.routes.schema import SchemaRead
from shirube.adapters.sqlite.schema_inspector import SqliteSchemaInspector
from shirube.domain.connection import SqliteConnectionParams

OUT_DIR = Path(__file__).resolve().parents[2] / "web" / "src" / "demo"
ROWS_PER_TABLE = 60


def dump_rows(db_path: str, schema_payload: dict) -> dict:
    """Read a small page of real rows for each table, keyed by the object id the map uses."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    rows_by_object: dict[str, dict] = {}
    try:
        for obj in schema_payload["objects"]:
            if obj["kind"] not in ("table", "view"):
                continue
            columns = [c["name"] for c in obj["columns"]]
            quoted = ", ".join(f'"{c}"' for c in columns)
            cur = conn.execute(f'SELECT {quoted} FROM "{obj["name"]}" LIMIT {ROWS_PER_TABLE}')
            rows_by_object[obj["id"]] = {
                "columns": columns,
                "rows": [[row[c] for c in columns] for row in cur.fetchall()],
            }
    finally:
        conn.close()
    return rows_by_object


def main() -> None:
    with resources.as_file(
        resources.files("shirube.samples") / "chinook.sqlite"
    ) as db_path:
        graph = SqliteSchemaInspector().inspect(
            SqliteConnectionParams(path=str(db_path)),
            schemas=[],
        )
        payload = SchemaRead.from_graph(graph).model_dump(by_alias=True)
        rows = dump_rows(str(db_path), payload)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "chinook-schema.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
    )
    (OUT_DIR / "chinook-rows.json").write_text(
        json.dumps(rows, ensure_ascii=False) + "\n"
    )
    print(
        f"Wrote {OUT_DIR}/chinook-schema.json — {len(payload['objects'])} objects, "
        f"{len(payload['relationships'])} relationships; "
        f"rows for {len(rows)} tables"
    )


if __name__ == "__main__":
    main()
