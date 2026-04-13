from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260413_020000_scope_projects_to_active_workspace"
down_revision = "20260413_010000_add_switchboard_agents_table"
branch_labels = None
depends_on = None

_DEFAULT_WORKSPACE_NAME = "recodee.com"
_DEFAULT_WORKSPACE_SLUG = "recodee-com"
_DEFAULT_WORKSPACE_LABEL = "Team"
_UQ_PROJECTS_WORKSPACE_NAME = "uq_projects_workspace_name"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("switchboard_workspaces"):
        op.create_table(
            "switchboard_workspaces",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("slug", sa.String(length=160), nullable=False),
            sa.Column("label", sa.String(length=64), nullable=False, server_default=sa.text("'Team'")),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
            sa.UniqueConstraint("slug"),
        )

    active_workspace_id = _ensure_active_workspace(bind)

    if not inspector.has_table("projects"):
        op.create_table(
            "projects",
            sa.Column("id", sa.String(), nullable=False),
            sa.Column("workspace_id", sa.String(), nullable=False),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("project_path", sa.Text(), nullable=True),
            sa.Column("sandbox_mode", sa.String(length=64), server_default="workspace-write", nullable=False),
            sa.Column("git_branch", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["workspace_id"], ["switchboard_workspaces.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("workspace_id", "name", name=_UQ_PROJECTS_WORKSPACE_NAME),
        )
        return

    existing_columns = {column["name"] for column in inspector.get_columns("projects")}

    if "workspace_id" not in existing_columns:
        with op.batch_alter_table("projects") as batch_op:
            batch_op.add_column(sa.Column("workspace_id", sa.String(), nullable=True))

    bind.execute(
        sa.text("UPDATE projects SET workspace_id = :workspace_id WHERE workspace_id IS NULL"),
        {"workspace_id": active_workspace_id},
    )

    with op.batch_alter_table("projects") as batch_op:
        batch_op.alter_column("workspace_id", existing_type=sa.String(), nullable=False)

    unique_constraints = inspector.get_unique_constraints("projects")
    has_workspace_unique = any(
        (constraint.get("name") == _UQ_PROJECTS_WORKSPACE_NAME)
        or (constraint.get("column_names") == ["workspace_id", "name"])
        for constraint in unique_constraints
    )

    if not has_workspace_unique:
        with op.batch_alter_table("projects") as batch_op:
            batch_op.create_unique_constraint(_UQ_PROJECTS_WORKSPACE_NAME, ["workspace_id", "name"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("projects"):
        return

    existing_columns = {column["name"] for column in inspector.get_columns("projects")}
    if "workspace_id" not in existing_columns:
        return

    with op.batch_alter_table("projects") as batch_op:
        unique_constraints = inspector.get_unique_constraints("projects")
        if any(constraint.get("name") == _UQ_PROJECTS_WORKSPACE_NAME for constraint in unique_constraints):
            batch_op.drop_constraint(_UQ_PROJECTS_WORKSPACE_NAME, type_="unique")
        batch_op.drop_column("workspace_id")


def _ensure_active_workspace(bind) -> str:
    row = bind.execute(
        sa.text(
            """
            SELECT id
            FROM switchboard_workspaces
            WHERE is_active = :is_active
            ORDER BY created_at ASC, name ASC
            LIMIT 1
            """
        ),
        {"is_active": True},
    ).fetchone()
    if row is not None and row[0]:
        return str(row[0])

    any_workspace = bind.execute(
        sa.text(
            """
            SELECT id
            FROM switchboard_workspaces
            ORDER BY created_at ASC, name ASC
            LIMIT 1
            """
        )
    ).fetchone()
    if any_workspace is not None and any_workspace[0]:
        workspace_id = str(any_workspace[0])
        bind.execute(sa.text("UPDATE switchboard_workspaces SET is_active = :is_active"), {"is_active": False})
        bind.execute(
            sa.text("UPDATE switchboard_workspaces SET is_active = :is_active WHERE id = :id"),
            {"is_active": True, "id": workspace_id},
        )
        return workspace_id

    workspace_id = "workspace_default_recodee"
    bind.execute(
        sa.text(
            """
            INSERT INTO switchboard_workspaces (id, name, slug, label, is_active)
            VALUES (:id, :name, :slug, :label, :is_active)
            """
        ),
        {
            "id": workspace_id,
            "name": _DEFAULT_WORKSPACE_NAME,
            "slug": _DEFAULT_WORKSPACE_SLUG,
            "label": _DEFAULT_WORKSPACE_LABEL,
            "is_active": True,
        },
    )
    return workspace_id
