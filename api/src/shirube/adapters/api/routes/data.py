"""Row-preview endpoint.

Returns a read-only page of one table or view's rows — with optional filtering and
sorting — so the explorer can show a table's contents beneath its structure.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from shirube.adapters.api.dependencies import get_data_service
from shirube.application.data import DataService
from shirube.domain.data import (
    CellValue,
    ColumnFilter,
    FilterOperator,
    RowPage,
    RowQuery,
    SortDirection,
    SortOrder,
)

router = APIRouter(prefix="/profiles", tags=["data"])


class FilterInput(BaseModel):
    """One filter condition sent with a row query."""

    column: str
    operator: Literal["eq", "ne", "contains", "is_null", "is_not_null"]
    value: str | None = None


class SortInput(BaseModel):
    """How to order the rows."""

    column: str
    direction: Literal["asc", "desc"] = "asc"


class RowQueryInput(BaseModel):
    """A request for a page of an object's rows.

    ``limit`` is capped so a single preview can never pull an unbounded result set.
    """

    limit: int = Field(default=100, ge=1, le=1000)
    offset: int = Field(default=0, ge=0)
    sort: SortInput | None = None
    filters: list[FilterInput] = Field(default_factory=list)

    def to_query(self) -> RowQuery:
        """Translate the request into the domain's :class:`RowQuery`."""
        return RowQuery(
            limit=self.limit,
            offset=self.offset,
            sort=(
                SortOrder(
                    column=self.sort.column,
                    direction=SortDirection(self.sort.direction),
                )
                if self.sort is not None
                else None
            ),
            filters=tuple(
                ColumnFilter(
                    column=condition.column,
                    operator=FilterOperator(condition.operator),
                    value=condition.value,
                )
                for condition in self.filters
            ),
        )


class RowPageRead(BaseModel):
    """A page of rows read back from an object."""

    columns: list[str]
    rows: list[list[CellValue]]
    has_more: bool
    offset: int
    limit: int

    @classmethod
    def from_page(cls, page: RowPage) -> "RowPageRead":
        """Build the response model from a domain row page."""
        return cls(
            columns=list(page.columns),
            rows=[list(row) for row in page.rows],
            has_more=page.has_more,
            offset=page.offset,
            limit=page.limit,
        )


ServiceDep = Annotated[DataService, Depends(get_data_service)]


@router.post("/{profile_id}/objects/{object_id}/rows", response_model=RowPageRead)
def read_rows(
    profile_id: str,
    object_id: str,
    body: RowQueryInput,
    service: ServiceDep,
) -> RowPageRead:
    """Read a filtered, sorted page of a table or view's rows.

    A missing profile or object surfaces as 404; a query naming an unknown column as 400;
    an unreachable or unreadable database as 400 with a translated, actionable message.
    """
    page = service.read_rows(profile_id, object_id, body.to_query())
    return RowPageRead.from_page(page)
