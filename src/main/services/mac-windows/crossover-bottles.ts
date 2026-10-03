import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REQUIRED_PREFIX_FILES = ["system.reg", "user.reg", "userdef.reg"];
const REQUIRED_PREFIX_DIRECTORIES = ["dosdevices", "drive_c"];

/**
 * Where CrossOver keeps bottles. CrossOver Preview defaults to ~/CXPBottles;
 * the release version keeps them under Application Support.
 */
export const getDefaultCrossOverBottleRoots = (homeDir = os.homedir()) => [
  path.join(homeDir, "CXPBottles"),
  path.join(homeDir, "Library", "Application Support", "CrossOver", "Bottles"),
];

export type BottleResolution =
  | { kind: "found"; bottlePath: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "none" };

const canonicalize = (value: string) =>
  fs.promises.realpath(value).catch(() => path.resolve(value));

const isDirectory = (value: string) =>
  fs.promises
    .stat(value)
    .then((stats) => stats.isDirectory())
    .catch(() => false);

const isFile = (value: string) =>
  fs.promises
    .stat(value)
    .then((stats) => stats.isFile())
    .catch(() => false);

const isInside = (child: string, parent: string) => {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
};

/** A directory that looks like a Wine prefix (which a CrossOver bottle is). */
export const isWinePrefixDirectory = async (prefixPath: string) => {
  const checks = await Promise.all([
    ...REQUIRED_PREFIX_FILES.map((name) => isFile(path.join(prefixPath, name))),
    ...REQUIRED_PREFIX_DIRECTORIES.map((name) =>
      isDirectory(path.join(prefixPath, name))
    ),
  ]);

  return checks.every(Boolean);
};

export const listCrossOverBottles = async (
  roots: string[] = getDefaultCrossOverBottleRoots()
): Promise<string[]> => {
  const bottles = new Set<string>();

  for (const root of roots) {
    const entries = await fs.promises
      .readdir(root, { withFileTypes: true })
      .catch(() => []);

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const candidate = path.join(root, entry.name);
      if (
        (await isDirectory(candidate)) &&
        (await isWinePrefixDirectory(candidate))
      ) {
        bottles.add(await canonicalize(candidate));
      }
    }
  }

  return [...bottles].sort();
};

/**
 * Host folders a bottle can see as drive letters: its own drive_c plus any
 * extra drives mapped through `dosdevices`. The catch-all `z:` -> `/` mapping
 * every bottle has, and raw devices, say nothing about where a game lives.
 */
const getBottleVisibleDirectories = async (bottlePath: string) => {
  const directories = new Set<string>([
    await canonicalize(path.join(bottlePath, "drive_c")),
  ]);
  const dosdevices = path.join(bottlePath, "dosdevices");
  const names = await fs.promises.readdir(dosdevices).catch(() => []);

  for (const name of names) {
    const link = path.join(dosdevices, name);
    const stats = await fs.promises.lstat(link).catch(() => null);
    if (!stats?.isSymbolicLink()) continue;

    const target = await fs.promises.readlink(link).catch(() => null);
    if (!target) continue;

    const absolute = path.resolve(dosdevices, target);
    if (absolute === path.parse(absolute).root) continue;
    if (absolute.startsWith("/dev/")) continue;

    directories.add(await canonicalize(absolute));
  }

  return [...directories];
};

/**
 * Finds the bottle a Windows executable belongs to: the one whose drive_c or
 * mapped drive contains it. The most specific (longest) match wins; two
 * bottles tying means Hydra cannot know which one runs the game.
 */
export const resolveCrossOverBottleForExecutable = async (
  executablePath: string,
  roots: string[] = getDefaultCrossOverBottleRoots()
): Promise<BottleResolution> => {
  const executable = await canonicalize(executablePath);
  const bottles = await listCrossOverBottles(roots);

  let bestLength = -1;
  let matches: string[] = [];

  for (const bottle of bottles) {
    const directories = await getBottleVisibleDirectories(bottle);
    const bottleBest = Math.max(
      -1,
      ...directories
        .filter((directory) => isInside(executable, directory))
        .map((directory) => directory.length)
    );

    if (bottleBest < 0) continue;

    if (bottleBest > bestLength) {
      bestLength = bottleBest;
      matches = [bottle];
    } else if (bottleBest === bestLength) {
      matches.push(bottle);
    }
  }

  if (matches.length === 1) return { kind: "found", bottlePath: matches[0] };
  if (matches.length > 1) return { kind: "ambiguous", candidates: matches };
  return { kind: "none" };
};
