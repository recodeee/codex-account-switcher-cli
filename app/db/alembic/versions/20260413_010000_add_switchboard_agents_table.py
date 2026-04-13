from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260413_010000_add_switchboard_agents_table"
down_revision = "20260413_000000_add_switchboard_workspaces_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("switchboard_agents"):
        existing_columns = {column["name"] for column in inspector.get_columns("switchboard_agents")}
        with op.batch_alter_table("switchboard_agents") as batch_op:
            if "status" not in existing_columns:
                batch_op.add_column(
                    sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'idle'"))
                )
            if "description" not in existing_columns:
                batch_op.add_column(sa.Column("description", sa.Text(), nullable=True))
            if "visibility" not in existing_columns:
                batch_op.add_column(
                    sa.Column("visibility", sa.String(length=16), nullable=False, server_default=sa.text("'workspace'"))
                )
            if "runtime" not in existing_columns:
                batch_op.add_column(
                    sa.Column(
                        "runtime",
                        sa.String(length=255),
                        nullable=False,
                        server_default=sa.text("'Codex (recodee)'"),
                    )
                )
            if "instructions" not in existing_columns:
                batch_op.add_column(
                    sa.Column("instructions", sa.Text(), nullable=False, server_default=sa.text("''"))
                )
            if "max_concurrent_tasks" not in existing_columns:
                batch_op.add_column(
                    sa.Column("max_concurrent_tasks", sa.Integer(), nullable=False, server_default=sa.text("6"))
                )
            if "avatar_data_url" not in existing_columns:
                batch_op.add_column(sa.Column("avatar_data_url", sa.Text(), nullable=True))
            if "created_at" not in existing_columns:
                batch_op.add_column(sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
            if "updated_at" not in existing_columns:
                batch_op.add_column(sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))

        existing_unique_constraints = {
            constraint["name"] for constraint in inspector.get_unique_constraints("switchboard_agents") if constraint.get("name")
        }
        if "uq_switchboard_agents_name" not in existing_unique_constraints:
            with op.batch_alter_table("switchboard_agents") as batch_op:
                batch_op.create_unique_constraint("uq_switchboard_agents_name", ["name"])
        return

    op.create_table(
        "switchboard_agents",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'idle'")),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("visibility", sa.String(length=16), nullable=False, server_default=sa.text("'workspace'")),
        sa.Column("runtime", sa.String(length=255), nullable=False, server_default=sa.text("'Codex (recodee)'")),
        sa.Column("instructions", sa.Text(), nullable=False, server_default=sa.text("''")),
        sa.Column("max_concurrent_tasks", sa.Integer(), nullable=False, server_default=sa.text("6")),
        sa.Column("avatar_data_url", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_switchboard_agents_name"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("switchboard_agents"):
        return
    op.drop_table("switchboard_agents")
