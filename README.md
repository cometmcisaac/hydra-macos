<div align="center">

[<img src="https://raw.githubusercontent.com/hydralauncher/hydra/refs/heads/main/resources/icon.png" width="144"/>](https://help.hydralauncher.gg)

  <h1 align="center">Hydra Launcher</h1>

  <p align="center">
    <strong>Hydra Launcher is an open-source gaming platform created to be the single tool that you need in order to manage your gaming library. Hydra is written in Node.js (Electron, React, Typescript) and Rust, with libtorrent providing the torrent engine.</strong>
  </p>

> **🍎 macOS fork.** This repository is a macOS-focused fork of
> [hydralauncher/hydra](https://github.com/hydralauncher/hydra). It adds Windows
> games via Steam Play / NotProton, CrossOver &amp; Bottles detection, Wine-prefix
> cloud saves, and real macOS application shortcuts — while staying mergeable
> with upstream. Prebuilt macOS releases are on the
> [releases page](https://github.com/cometmcisaac/hydra-macos/releases); see
> **[docs/macos.md](./docs/macos.md)** for everything else.

[![build](https://img.shields.io/github/actions/workflow/status/hydralauncher/hydra/build.yml)](https://github.com/hydralauncher/hydra/actions)
[![release](https://img.shields.io/github/package-json/v/hydralauncher/hydra)](https://github.com/hydralauncher/hydra/releases)
[![chocolatey](https://img.shields.io/chocolatey/v/hydralauncher.svg)](https://community.chocolatey.org/packages/hydralauncher)

![Hydra Launcher Home Page](./docs/screenshot.png)

</div>

## Features

- Add games that you own to your library
- Have a nice profile that shows what you are playing to your friends
- Save your game progress in the cloud with Hydra Cloud
- Unlock achievements
- Navigate through a rich catalogue with a powerful suggestion algorithm
- Discover new games that you haven't played before

## macOS (this fork)

Upstream Hydra targets Windows and Linux. This fork adds macOS support:

- **Windows games on macOS** — `.exe` games launch through Steam Play +
  [NotProton](https://github.com/notproton) as managed non-Steam shortcuts.
- **CrossOver & Bottles** — Hydra detects the bottle containing a game (or uses
  the Wine prefix you pick) and launches it there.
- **Cloud saves in Wine prefixes** — Windows-game saves sync from inside the
  Wine prefix; native macOS games keep normal save locations.
- **Application shortcuts** — "Create shortcut" writes a real `.app` bundle to
  `/Applications` that relaunches the game through Hydra.
- **Update notifications** — the app tells you when a newer release of this fork
  is available and links to the download page (unsigned macOS builds can't
  self-install).

Full details, build instructions, and the upstream-sync procedure live in
**[docs/macos.md](./docs/macos.md)**.

### Download / quick start (macOS)

Grab the latest DMG for your Mac from the
[releases page](https://github.com/cometmcisaac/hydra-macos/releases) (arm64 for
Apple Silicon, x64 for Intel). Releases are unsigned; after copying to
`/Applications` run `xattr -cr /Applications/Hydra.app` before opening.

Or build it yourself:

```sh
yarn install
yarn build:mac          # -> dist/Hydra-<version>.dmg
```

### Keeping the fork up to date

`main` mirrors `upstream/main`; the macOS work lives on `macos-native`. Pull
upstream updates with a merge:

```sh
git fetch upstream
git checkout macos-native && git merge upstream/main
```

## Build from source and contributing

Please, refer to our Documentation pages: [docs.hydralauncher.gg](https://docs.hydralauncher.gg/getting-started)

### Local development requirements

- Node.js + Yarn
- Rust toolchain (for `hydra-native`)
- Git and a C++ toolchain (Visual Studio C++ Build Tools on Windows, GCC/Clang on Linux, Xcode command-line tools on macOS). The native build obtains CMake and CTest automatically through vcpkg.

After installing dependencies, `postinstall` now builds the Rust native addon automatically (`hydra-native/hydra-native.node`).

The native build includes a Rust wrapper around pinned libtorrent. Development and packaged torrenting no longer require Python.

On Windows x64 and Linux x64, the libtorrent bridge comes prebuilt from `native/torrent-bridge/prebuilt`, so installs skip compiling libtorrent through vcpkg. Other platforms build it from source. When a branch push changes `native/torrent-bridge` or `scripts/build-torrent-bridge.cjs`, the "Torrent bridge prebuilts" workflow rebuilds the binaries and commits them to that branch; until then, installs build the bridge from source. Set `HYDRA_TORRENT_BRIDGE_FROM_SOURCE=1` to always build it from source.

## Contributors

<a href="https://github.com/hydralauncher/hydra/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=hydralauncher/hydra" />
</a>

## License

Hydra is licensed under the [MIT License](LICENSE).
