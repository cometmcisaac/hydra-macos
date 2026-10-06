# Hydra on macOS

This branch (`macos-native`) is a **macOS-focused fork** of
[hydralauncher/hydra](https://github.com/hydralauncher/hydra). Upstream ships
Windows and Linux builds; this fork adds first-class macOS support for running
Windows games, syncing their cloud saves, and producing real macOS application
shortcuts.

The fork is deliberately structured so upstream can be pulled in and merged
without rewriting history. See [Staying in sync with upstream](#staying-in-sync-with-upstream).

---

## What this fork adds

| Integration                       | What it does                                                                                                                                                              | Key code                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Windows games on macOS**        | A Windows `.exe` picked in Hydra is launched through Steam Play + [NotProton](https://github.com/notproton) instead of being unlaunchable.                                | `src/main/helpers/launch-game.ts`                                                                  |
| **CrossOver / Bottles detection** | Finds which CrossOver bottle an executable belongs to (or uses the prefix you chose) and launches it there.                                                               | `src/main/services/mac-windows/crossover-bottles.ts`                                               |
| **Backend resolution**            | One decision — `steam`, `crossover`, `steam-shortcut` or `default-handler` — drives both launching and cloud saves.                                                       | `src/main/services/mac-windows/mac-windows-runtime.ts`                                             |
| **Automatic Steam shortcuts**     | Non-Steam Windows games get a managed Steam non-Steam shortcut with the NotProton compatibility tool so Steam Play runs them.                                             | `src/main/services/steam-shortcuts/steam-shortcuts.ts`, `notproton-prefix.ts`                      |
| **Cloud saves in Wine prefixes**  | Cloud-save paths for Windows games are resolved inside the Wine prefix (reusing the existing Windows→Wine translation), while native macOS games keep the `mac` platform. | `src/main/services/cloud-save/cloud-save-platform.ts`                                              |
| **macOS executable picker**       | The file picker accepts both `.app` (native) and `.exe` (Windows) on macOS.                                                                                               | `src/shared/constants.ts`                                                                          |
| **Application shortcuts**         | "Create shortcut" writes a real `.app` bundle to `/Applications` (or `~/Applications`) that relaunches the game through Hydra.                                            | `src/main/helpers/create-macos-app-shortcut.ts`, `src/main/events/library/create-game-shortcut.ts` |

---

## Requirements

- **macOS.** Apple Silicon and Intel are both supported.
- **Steam** for Windows-game support. Steam Play + NotProton must be able to run
  your game.
- Optionally, **CrossOver** (release or Preview) if your game lives in a
  CrossOver bottle. Hydra detects bottles in:
  - `~/CXPBottles` (CrossOver Preview default)
  - `~/Library/Application Support/CrossOver/Bottles`

---

## How a Windows game is launched

Hydra picks one backend the first time a Windows executable is launched. The
same backend/prefix is reused for cloud saves, so launching and saving always
agree.

```
resolveMacWindowsRuntime()
├── Game is in a macOS Steam library            -> "steam"          (Steam Play / NotProton)
├── A CrossOver bottle contains the executable  -> "crossover"      (or the prefix you chose)
├── Any other non-Steam Windows game            -> "steam-shortcut" (managed non-Steam shortcut)
└── Otherwise                                   -> "default-handler" (open with the OS .exe handler)
```

Notes:

- A prefix Hydra derived itself for Steam Play (under `steamapps/compatdata`)
  is re-derived on every launch; only a prefix **outside** Steam's `compatdata`
  counts as your own choice.
- If two bottles could contain the executable, Hydra records the candidates as
  `ambiguousBottles` in the launch log instead of guessing.
- For a managed non-Steam shortcut, Hydra derives a stable Steam app id from
  `shop`/`objectId` so the same game keeps the same shortcut and prefix across
  launches.

---

## Cloud saves

Windows games run under Wine/Steam Play, so their saves live inside a Wine
prefix, not in native macOS folders. The cloud-save pipeline models that
exactly like Linux: a Windows executable on macOS is reported as the Linux
platform so the existing Windows→Wine path translation is reused. Native macOS
games (`.app`) are reported as `mac` and use normal macOS save locations.

See `src/main/services/cloud-save/cloud-save-platform.ts`.

---

## Application shortcuts

Choosing **Create Application Shortcut** for a game writes a minimal `.app`
bundle:

```
<Game Name>.app/
└── Contents/
    ├── Info.plist            # bundle id gg.hydralauncher.shortcut.<hash>
    ├── MacOS/<Game Name>     # #!/bin/sh launcher, chmod 755
    └── Resources/appicon.icns (best-effort, via `sips`)
```

The launcher `exec`s the Hydra binary with the game's run deep link
(`hydralauncher://run?shop=…&objectId=…`). Hydra resolves the macOS runtime and
launches the game exactly as pressing Play would, so the shortcut keeps working
even if the backend changes later. The bundle goes to `/Applications` when
writable, otherwise `~/Applications`.

---

## Building

### Locally

Requirements: Node.js + Yarn, the Rust toolchain, Xcode command-line tools, and
Git. The native build obtains CMake/CTest through vcpkg automatically.

```sh
yarn install
yarn build:mac                 # native addon + electron-vite + electron-builder --mac
```

Artifacts land in `dist/` (`Hydra-<version>.dmg`, `.zip`).

Builds are **unsigned**, so macOS Gatekeeper will complain on first open. After
copying `Hydra.app` to `/Applications`:

```sh
xattr -cr /Applications/Hydra.app
```

Alternatively, right-click the app → **Open** → **Open** once.

For a quick unpacked build during development:

```sh
yarn build:unpack            # -> dist/mac-<arch>/Hydra.app
```

### With GitHub Actions

`.github/workflows/macos-build.yml` builds unsigned `arm64` and `x64` dmgs on
pushes to `macos-native` (and on manual dispatch), uploading them as workflow
artifacts. It never touches the upstream Windows/Linux workflows, so it stays
merge-safe.

The build reads the usual `MAIN_VITE_*` / `RENDERER_VITE_*` variables. Public
production defaults are baked into the workflow; override them with repository
Actions **Variables** if you point at your own backend.

---

## Staying in sync with upstream

The fork uses a merge (not rebase) model:

- `main` is kept as a **pristine mirror** of `upstream/main`.
- `macos-native` is the long-lived macOS branch. Upstream is merged into it.

One-time remote setup:

```sh
git remote -v
# origin   -> https://github.com/<you>/hydra-macos.git   (your fork)
# upstream -> https://github.com/hydralauncher/hydra.git (upstream)
```

To pull in upstream updates:

```sh
git fetch upstream
git checkout macos-native
git merge upstream/main
# resolve conflicts, then:
yarn typecheck && yarn test
```

`git merge` is preferred over `git rebase` so published commits are never
rewritten and conflicts are resolved once per upstream change. The most likely
conflict spot is
`src/main/services/cloud-save/cloud-save-game-context.ts`, where upstream's
cloud-save platform selection overlaps the fork's macOS resolution — keep both
(compute `executablePath` first, then `resolveCloudSavePlatform(...)`).

When upstream cuts a release, bump the version from the release branch:

```sh
git merge upstream/release/vX.Y.Z
```

---

## Known limitations

- **Unsigned builds.** There is no Developer ID certificate; distribution is
  manual and requires `xattr -cr` (see above).
- **Steam overlay / achievements** are only available for games launched
  through Steam itself; Hydra-launched shortcuts may not show them.
- **NotProton required.** Windows-game launch assumes Steam Play + NotProton is
  installed and configured.
- **No native CodeWeavers integration.** Hydra only reads/uses existing
  CrossOver bottles; it does not create or manage them.

---

## File map

```
src/main/helpers/launch-game.ts                              launch routing incl. macOS backend
src/main/helpers/create-macos-app-shortcut.ts                .app bundle creation
src/main/services/mac-windows/mac-windows-runtime.ts         backend resolution
src/main/services/mac-windows/crossover-bottles.ts           bottle discovery / matching
src/main/services/steam-shortcuts/steam-shortcuts.ts         non-Steam shortcut management
src/main/services/steam-shortcuts/steam-shortcuts-core.ts    shortcut file (de)serialization
src/main/services/steam-shortcuts/notproton-prefix.ts        NotProton/Wine prefix paths
src/main/services/cloud-save/cloud-save-platform.ts          cloud-save platform mapping
src/shared/constants.ts                                      executable picker filters
src/main/events/library/create-game-shortcut.ts              shortcut entry point
```
