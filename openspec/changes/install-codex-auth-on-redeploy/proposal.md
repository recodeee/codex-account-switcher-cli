## Why
Operators use `codex-auth` to switch local snapshots that codex-lb consumes, but redeploy flows do not guarantee the CLI is present or up to date.
This creates avoidable drift where codex-lb features that integrate with local snapshot switching depend on manual `npm i -g` steps.

## What Changes
- Update `redeploy.sh` to install/update `codex-auth` globally from the bundled `./codex-account-switcher` package before Docker rebuild/restart steps.
- Add an explicit opt-out flag/environment toggle for environments that do not want global installation.
- Document the redeploy behavior and opt-out controls.

## Impact
- Local/operator redeploy flows keep `codex-auth` aligned with the repository version.
- codex-lb + codex-auth integrations work out of the box after redeploy.
- Operators can disable the install step with `--skip-codex-auth-install` or `CODEX_LB_INSTALL_CODEX_AUTH=false`.
