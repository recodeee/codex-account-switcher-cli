from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260413_030000_add_projects_workspace_fk"
down_revision = "20260413_020000_scope_projects_to_active_workspace"
branch_labels = None
depends_on = None

_FK_NAME = "fk_projects_workspace_id"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("projects") or not inspector.has_table("switchboard_workspaces"):
        return

    existing_columns = {column["name"] for column in inspector.get_columns("projects")}
    if "workspace_id" not in existing_columns:
        return

    existing_fks = inspector.get_foreign_keys("projects")
    has_workspace_fk = any(
        (fk.get("referred_table") == "switchboard_workspaces")
        and (fk.get("constrained_columns") == ["workspace_id"])
        for fk in existing_fks
    )
    if has_workspace_fk:
        return

    with op.batch_alter_table("projects") as batch_op:
        batch_op.create_foreign_key(
            _FK_NAME,
            "switchboard_workspaces",
            ["workspace_id"],
            ["id"],
            ondelete="CASCADE",
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("projects"):
        return

    existing_fks = inspector.get_foreign_keys("projects")
    fk_name = next(
        (
            fk.get("name")
            for fk in existing_fks
            if (fk.get("referred_table") == "switchboard_workspaces")
            and (fk.get("constrained_columns") == ["workspace_id"])
            and fk.get("name")
        ),
        None,
    )

    if fk_name is None:
        return

    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_constraint(fk_name, type_="foreignkey")
