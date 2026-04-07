from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260407_233000_add_projects_table"
down_revision = "20260403_000000_add_codex_session_task_preview"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("projects"):
        existing_columns = {
            column["name"] for column in inspector.get_columns("projects")
        }
        with op.batch_alter_table("projects") as batch_op:
            if "project_path" not in existing_columns:
                batch_op.add_column(sa.Column("project_path", sa.Text(), nullable=True))
            if "sandbox_mode" not in existing_columns:
                batch_op.add_column(
                    sa.Column(
                        "sandbox_mode",
                        sa.String(length=64),
                        nullable=False,
                        server_default="workspace-write",
                    )
                )
            if "git_branch" not in existing_columns:
                batch_op.add_column(sa.Column("git_branch", sa.String(length=255), nullable=True))
        return

    op.create_table(
        "projects",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("project_path", sa.Text(), nullable=True),
        sa.Column("sandbox_mode", sa.String(length=64), server_default="workspace-write", nullable=False),
        sa.Column("git_branch", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("projects"):
        return
    op.drop_table("projects")
