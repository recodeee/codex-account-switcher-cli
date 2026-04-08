from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20260408_020000_add_medusa_admin_second_factor_table"
down_revision = "20260408_010000_repair_projects_table_columns"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("medusa_admin_second_factor"):
        existing_columns = {
            column["name"] for column in inspector.get_columns("medusa_admin_second_factor")
        }
        with op.batch_alter_table("medusa_admin_second_factor") as batch_op:
            if "totp_enabled" not in existing_columns:
                batch_op.add_column(
                    sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false())
                )
            if "totp_secret_encrypted" not in existing_columns:
                batch_op.add_column(sa.Column("totp_secret_encrypted", sa.LargeBinary(), nullable=True))
            if "totp_last_verified_step" not in existing_columns:
                batch_op.add_column(sa.Column("totp_last_verified_step", sa.Integer(), nullable=True))
        return

    op.create_table(
        "medusa_admin_second_factor",
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("totp_secret_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("totp_last_verified_step", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("email"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("medusa_admin_second_factor"):
        return
    op.drop_table("medusa_admin_second_factor")
