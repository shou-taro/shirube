"""SQLAlchemy implementation of the AI provider config repository.

A singleton store: the AI provider is configured once, app-wide, so the table holds at most
one row (see :class:`AiProviderConfigRow`). Each method runs in its own short session, like
the profile repository — these are infrequent, independent operations for a single user.
"""

from sqlalchemy.orm import Session, sessionmaker

from shirube.adapters.persistence.models import AI_PROVIDER_CONFIG_ID, AiProviderConfigRow
from shirube.domain.ai import AiProviderConfig, AiProviderKind


def _to_domain(row: AiProviderConfigRow) -> AiProviderConfig:
    """Map a persisted row to a domain :class:`AiProviderConfig`."""
    return AiProviderConfig(
        kind=AiProviderKind(row.kind),
        model=row.model,
        base_url=row.base_url,
        context_window=row.context_window,
    )


class SqlAiConfigRepository:
    """Stores the single AI provider config in the local app-state database."""

    def __init__(self, session_factory: sessionmaker[Session]) -> None:
        self._session_factory = session_factory

    def get(self) -> AiProviderConfig | None:
        """Return the configured provider, or ``None`` if none is set."""
        with self._session_factory() as session:
            row = session.get(AiProviderConfigRow, AI_PROVIDER_CONFIG_ID)
            return _to_domain(row) if row is not None else None

    def set(self, config: AiProviderConfig) -> None:
        """Store the provider config, replacing any existing one.

        Upserts the singleton row: its fields are overwritten in place when present, or a
        fresh row is inserted under the constant id when not.
        """
        with self._session_factory() as session:
            row = session.get(AiProviderConfigRow, AI_PROVIDER_CONFIG_ID)
            if row is None:
                session.add(
                    AiProviderConfigRow(
                        id=AI_PROVIDER_CONFIG_ID,
                        kind=config.kind.value,
                        model=config.model,
                        base_url=config.base_url,
                        context_window=config.context_window,
                    )
                )
            else:
                row.kind = config.kind.value
                row.model = config.model
                row.base_url = config.base_url
                row.context_window = config.context_window
            session.commit()

    def clear(self) -> None:
        """Remove the provider config; a no-op if none is set."""
        with self._session_factory() as session:
            row = session.get(AiProviderConfigRow, AI_PROVIDER_CONFIG_ID)
            if row is not None:
                session.delete(row)
                session.commit()
