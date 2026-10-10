# AGENTS.md

Operational context for this repository. Coding conventions live in [`.cursorrules`](./.cursorrules) (upstream's file — read it, don't edit it). User-facing feature docs live in [`docs/macos.md`](./docs/macos.md).

## What this repo is

A macOS port of [Hydra Launcher](https://github.com/hydralauncher/hydra). It tracks upstream closely and adds Windows-game support on macOS (via Steam Play/NotProton and CrossOver), Wine-prefix cloud saves, real `.app` shortcuts, and a macOS build/release pipeline.

The guiding constraint: **this branch must stay mergeable with upstream.** Prefer additive, self-contained changes. Avoid editing upstream-owned files unless unavoidable.

## Branch and remote model

|                |                                                                                  |
| -------------- | -------------------------------------------------------------------------------- |
| Working branch | `macos-native` (long-lived; all macOS work lands here)                           |
| `origin`       | `cometmcisaac/hydra-macos` — the fork, push here                                 |
| `upstream`     | `hydralauncher/hydra` — read-only, merge from here                               |
| `main`         | pristine mirror of upstream, tracks `origin/main`. Never commit macOS work here. |

Fork default branch is `macos-native`.

**Pushing to `upstream` is deliberately disabled.** Its push URL is set to the literal string `DISABLED` in this clone's config, so `git push upstream …` fails instead of touching `hydralauncher/hydra`. Fetch and merge still work normally. **Do not "fix" this** — it is an intentional guard, not a misconfiguration. To restore: `git remote set-url --push upstream https://github.com/hydralauncher/hydra.git`.

## Standing rules

1. **Never bump `package.json` version on the fork.** The version must always match the newest upstream release. Upstream cuts releases on _branches_, so `upstream/main` usually trails the latest release — the newest release branch (e.g. `upstream/release/v4.1.6`) is the source of truth for the version.
2. **Experimental builds use tags only**: `vX.Y.Z-macos-experimental`, `-experimental-2`, `-experimental-3`, … Never touch the version to make an experimental build.
3. Tags ending `-macos-experimental*` become GitHub **pre-releases**, so `/releases/latest` keeps resolving to the stable `vX.Y.Z-macos` and the in-app updater feed is unaffected. Preserve that property when editing the workflow.
4. Commit style: subject-only, `macOS:` prefix, no body (matches upstream). `commitlint` + husky enforce this.

## Commands

```bash
yarn typecheck                              # tsc for node + web configs
yarn lint                                   # eslint --fix
yarn format                                 # prettier --write .  (also runs on pre-commit)
yarn test                                   # full node:test suite

# Build a macOS app bundle (needs the native addon built first)
rm -rf out dist && yarn build && npx electron-builder --mac --dir
yarn build:mac                              # native + electron-vite + electron-builder --mac
```

Notes:

- `yarn build` runs `typecheck` first, so a green `yarn build` implies a green typecheck.
- When running `tsc` manually, always pass `--composite false` (as the scripts do). Without it you get a spurious pre-existing TS7056 in `src/locales/index.ts`.
- Use the shell tool's `workdir` parameter to change directory. **Do not** write `cd <path> && rm -rf …` — that form is blocked by a safety hook.

## Safety constraints in this environment

- `rm -rf` is blocked when the command begins in the home/CWD (safety rule `rm.recursive-force-home-cwd`). Use the `workdir` parameter instead of chaining `cd`.
- `git checkout -- <file>` is blocked as a "discards uncommitted changes" operation. To discard safely, use `git stash push -- <file>`.
- Reading `.env` is blocked (secrets). Don't retry; use `.env.example`.
- GitHub-hosted **macOS runner minutes are a limited monthly quota**. A full two-arch run costs ~30 min. Always cancel redundant runs on the same commit. Note that branch pushes and tag pushes have _different_ concurrency groups, so pushing a tag does **not** cancel the branch run — cancel the branch run yourself.

## Syncing with upstream

```bash
git fetch upstream
git merge upstream/main
yarn typecheck && yarn test
git push origin macos-native
```

Expect conflicts mainly in `src/locales/en/translation.json`, `src/main/helpers/launch-game.ts`, `src/main/services/process-watcher.ts`, `src/preload/index.ts`, and `src/renderer/src/declaration.d.ts`. Historically upstream's edits there are Linux-only (umu launcher) or cloud-save work in different regions than the macOS code.

One recurring conflict, in `src/main/services/cloud-save/cloud-save-game-context.ts`: upstream keeps a `getCloudSavePlatform()` function while this fork replaced it with `resolveCloudSavePlatform()` from `src/main/services/mac-windows/cloud-save-platform.ts`. Keep both — resolve upstream's `emulatorProvider`/`emulatorExecutablePath` first, derive `executablePath`, and only then call `resolveCloudSavePlatform`, since the emulator branch can change `executablePath`.

When upstream publishes a new version, merge the release branch (it usually only touches `package.json`):

```bash
git fetch upstream && git merge upstream/release/vX.Y.Z
```

## Tests

`yarn test` runs `node --import ./scripts/register-ts-node.mjs --test "src/**/*.test.ts" "scripts/*.test.mjs"`.

- Baseline: **1178/1179 passing**.
- The single failure, `rejects early exits with the umu failure detail` in `src/main/services/process-watcher`-adjacent `src/main/services/umu-launch-monitor.test.ts`, is a **pre-existing upstream flake** that only fails under full-suite parallel load. It has been reproduced on a pristine `upstream/main` checkout. Don't chase it as a regression.
- Test files must **not** import `electron`. Import siblings with an explicit extension — convention is `.js` for main-process modules, `.ts` also works. Extensionless relative imports **fail to resolve** under this runner; this silently broke a test once already.

## macOS architecture — the non-obvious parts

Read these before touching macOS code; each was expensive to discover.

**CrossOver settings are environment variables in a file, not launch arguments.** CrossOver's launcher (`lib/perl/CXBottle.pm`) unconditionally re-applies the bottle's `[EnvironmentVariables]` from `cxbottle.conf` at startup, overwriting anything passed at launch time. So per-game settings are applied by _editing `cxbottle.conf` directly_, then restoring the original when the game exits. Bottle roots: `~/CXPBottles` and `~/Library/Application Support/CrossOver/Bottles`. Settings keys: `CX_GRAPHICS_BACKEND` (renderer), `WINEMSYNC`, `D3DM_ENABLE_METALFX`, `DXMT_ENABLE_NVEXT`, `D3DM_SUPPORT_DXR`, `D3DM_MTL4`. There is no single "DLSS" switch — under D3DMetal the upscaler is MetalFX, under DXMT it's NVAPI extensions.

**Backend resolution is automatic, with no user override.** `resolveMacWindowsRuntime` (`src/main/services/mac-windows/mac-windows-runtime.ts`) returns `'steam' | 'crossover' | 'steam-shortcut' | 'default-handler'`. This is deliberate — don't add an override setting without asking.

**Deep links are how Hydra re-enters itself.** `hydralauncher://run?shop=…&objectId=…` is handled in `src/main/index.ts`; the single-instance lock forwards the argument to a running instance. macOS `.app` shortcuts exec Hydra's binary _with the deep link as an argument_ rather than relying on URL-scheme routing.

**Renderer env vars are a separate namespace from main.** electron-vite's per-target `envPrefix` means `MAIN_VITE_*` is **not** inlined in the renderer bundle. Anything the renderer needs must use a `RENDERER_VITE_*` variable (e.g. the update-feed link). Declare new vars in both `src/main/vite-env.d.ts` and `src/renderer/src/vite-env.d.ts`.

**Big Picture ships inside the renderer bundle.** There is no `out/big-picture`; it is bundled via `src/renderer/src/main.tsx`. It shares the desktop `game_details` i18n namespace, and the global `Electron` interface in `src/renderer/src/declaration.d.ts` is the bridge type to extend.

**Ray tracing is hidden on Apple M1/M2.** `supportsAppleRayTracing(cpuModel)` in `src/shared/crossover-settings.ts` gates the DXR control; `cpuModel` is exposed through preload. Don't "fix" this by showing the option unconditionally.

## Update notifications

`electron-updater`'s feed is repointed at the fork via `MAIN_VITE_UPDATE_FEED_OWNER` / `MAIN_VITE_UPDATE_FEED_REPO` (defaulting to upstream), and the renderer's release-page link via the `RENDERER_VITE_UPDATE_FEED_*` pair. The macOS workflow passes `owner=cometmcisaac`, `repo=hydra-macos`, and the release job publishes `latest-mac.yml`.

This is **notify-only** on macOS by necessity: Squirrel.Mac requires a code-signed app, and these builds are unsigned, so `quitAndInstall()` would silently do nothing. Upstream's `isAutoInstallEnabled()` already returns `false` on darwin.

## macOS CI (`.github/workflows/macos-build.yml`)

- There is no `branches:` filter — only tag pushes (`v*-macos`, `v*-macos-experimental*`) and `workflow_dispatch`. Merging upstream commits into `main` (the pristine upstream mirror) will **not** fire this workflow, so upstream syncs don't burn quota. Concurrency group is per-ref, so a tag push doesn't cancel a branch run.

Three upstream macOS-portability bugs were fixed here; keep them in mind if the workflow is refactored:

1. `native/torrent-bridge/CMakeLists.txt` — the test target needs its own `target_compile_features(torrent_bridge_test PRIVATE cxx_std_17)`; the library's is `PRIVATE`, and Apple clang defaults to `gnu++98`.
2. The build step sets `NODE_OPTIONS=--max-old-space-size=4096`; the 7 GB runners otherwise OOM the renderer bundle (exit 134).
3. The x64 leg must use `macos-15-intel`; GitHub retired the `macos-13` image on 2025-12-08.

Two upstream workflows are **disabled fork-side via the GitHub API** rather than by editing their files, so upstream merges stay pristine: "Trigger Landing Page Build" and "Update AUR Package". Both fire on `release: published` and need secrets the fork doesn't have. Re-enable with `gh workflow enable` if that ever changes.

## Releases

Builds are **unsigned**. Users must `xattr -cr /Applications/Hydra.app` after copying it in. GitHub release assets are renamed per-arch (`Hydra-<version>-arm64.dmg`, `-x64.dmg`, `-arm64-mac.zip`, `-mac.zip`) plus `latest-mac.yml` (arm64).

Experimental release titles currently render as `Hydra 4.1.6-macos-experimental-3 (macOS)` because the workflow title only strips the leading `v`. The user has decided this is fine — don't "fix" it unsolicited.

## Repo housekeeping

- The original downloaded macOS patches that seeded this work were deleted after verifying every file and symbol they introduced was already present in the tree. Git history is the record of that work; nothing depends on those files.
- `*.textClipping` is gitignored — macOS clipboard artifacts were accidentally committed once.
- Gitignore already covers agent scratch files: `Future-updates.md`, `TO-DO.md`, `.planning/`, `.claude/`.
