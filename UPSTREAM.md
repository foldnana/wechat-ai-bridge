# Upstream provenance

- Source repository: https://github.com/nexu-io/nexu
- Imported commit: `dadfb1c8085bfaf500440cd86a66c7e5b3961a1b`
- Upstream commit date: 2026-04-16
- Import date: 2026-10-20 (Asia/Shanghai)
- License: MIT; original `LICENSE` retained without modification.
- Import method: tracked source snapshot, with independent Git history. This is not a GitHub fork and has no automatic synchronization.

## Initialization changes

- Replaced root README, AGENTS and CLAUDE instructions with this project's scope.
- Archived the originals under `upstream-reference/`.
- Moved `.github/workflows` to `upstream-reference/github-workflows` so upstream CI, publishing, community and promotion jobs cannot run on this repository.
- Moved upstream CODEOWNERS to `upstream-reference/CODEOWNERS`.
- Added product scope, roadmap, attribution and local-data ignore patterns.
- Application code and runtime defaults were initially imported unchanged. Subsequent product removals and validation are recorded in `docs/project/CLEANUP.md`; internal package names remain inherited.

## Updating the baseline

Add or fetch the upstream remote only for deliberate comparison. Review relevant fixes in small changes; do not automatically overwrite this project's instructions, workflows, app identity, telemetry or update configuration.

The original source is MIT licensed. Every bundled dependency, plugin, font, image, video and other asset must be inventoried before distribution; the root license alone is not an audit of the bundle.
