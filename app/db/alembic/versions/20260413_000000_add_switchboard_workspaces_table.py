from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260413_000000_add_switchboard_workspaces_table"
down_revision = "20260408_020000_add_medusa_admin_second_factor_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("switchboard_workspaces"):
        existing_columns = {column["name"] for column in inspector.get_columns("switchboard_workspaces")}
        with op.batch_alter_table("switchboard_workspaces") as batch_op:
            if "slug" not in existing_columns:
                batch_op.add_column(sa.Column("slug", sa.String(length=160), nullable=True))
            if "label" not in existing_columns:
                batch_op.add_column(
                    sa.Column("label", sa.String(length=64), nullable=False, server_default=sa.text("'Team'"))
                )
            if "is_active" not in existing_columns:
                batch_op.add_column(
                    sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.false())
                )
            if "created_at" not in existing_columns:
                batch_op.add_column(sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
            if "updated_at" not in existing_columns:
                batch_op.add_column(sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()))
        if "slug" in existing_columns:
            return

        op.execute(sa.text("UPDATE switchboard_workspaces SET slug = lower(replace(name, ' ', '-')) WHERE slug IS NULL"))
        op.alter_column("switchboard_workspaces", "slug", existing_type=sa.String(length=160), nullable=False)
        return

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


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("switchboard_workspaces"):
        return
    op.drop_table("switchboard_workspaces")
