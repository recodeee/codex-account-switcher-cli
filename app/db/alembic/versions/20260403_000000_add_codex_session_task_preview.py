from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.engine import Connection

revision = "20260403_000000_add_codex_session_task_preview"
down_revision = "20260402_230000_add_devices_table"
branch_labels = None
depends_on = None


def _table_exists(connection: Connection, table_name: str) -> bool:
    inspector = sa.inspect(connection)
    return inspector.has_table(table_name)


def _columns(connection: Connection, table_name: str) -> set[str]:
    inspector = sa.inspect(connection)
    if not inspector.has_table(table_name):
        return set()
    return {str(column["name"]) for column in inspector.get_columns(table_name) if column.get("name") is not None}


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "sticky_sessions"):
        return

    columns = _columns(bind, "sticky_sessions")
    missing_columns = [
        column_name
        for column_name in ("task_preview", "task_updated_at")
        if column_name not in columns
    ]
    if not missing_columns:
        return

    with op.batch_alter_table("sticky_sessions") as batch_op:
        if "task_preview" in missing_columns:
            batch_op.add_column(sa.Column("task_preview", sa.Text(), nullable=True))
        if "task_updated_at" in missing_columns:
            batch_op.add_column(sa.Column("task_updated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "sticky_sessions"):
        return

    columns = _columns(bind, "sticky_sessions")
    removable_columns = [
        column_name
        for column_name in ("task_preview", "task_updated_at")
        if column_name in columns
    ]
    if not removable_columns:
        return

    with op.batch_alter_table("sticky_sessions") as batch_op:
        if "task_updated_at" in removable_columns:
            batch_op.drop_column("task_updated_at")
        if "task_preview" in removable_columns:
            batch_op.drop_column("task_preview")
