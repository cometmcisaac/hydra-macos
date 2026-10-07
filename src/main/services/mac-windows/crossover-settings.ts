import fs from "node:fs";
import path from "node:path";

import {
  CROSSOVER_SETTING_ENV_KEYS,
  hasAnyCrossoverSetting,
  type GameCrossoverSettings,
} from "../../../shared/crossover-settings.js";

/**
 * CrossOver stores per-bottle settings as environment variables in
 * `cxbottle.conf`, and its launcher overwrites whatever environment Hydra
 * passes at launch with those values. To make a per-game choice actually take
 * effect, Hydra edits the file directly and restores the previous values once
 * the game exits.
 */

export interface BottleEnvironmentEntry {
  key: string;
  value: string;
}

const ENVIRONMENT_SECTION = "[EnvironmentVariables]";

// Serializes the Confirmation/OpenStep-style arrays CrossOver uses, e.g.
// `"KEY" = "value";`. Safe for section placement because each statement is one
// line and may contain any character except a newline.
export const serializeBottleEnvironmentEntries = (
  entries: BottleEnvironmentEntry[]
): string[] => entries.map(({ key, value }) => `"${key}" = "${value}";`);

export const insertEnvironmentEntries = (
  content: string,
  entries: BottleEnvironmentEntry[]
): string => {
  if (entries.length === 0) return content;

  const lines = content.split("\n");
  const sectionIndex = lines.findIndex(
    (line) => line.trim() === ENVIRONMENT_SECTION
  );

  if (sectionIndex === -1) {
    const separator = content.endsWith("\n") || content === "" ? "" : "\n";
    const serialized = serializeBottleEnvironmentEntries(entries);
    return `${content}${separator}${ENVIRONMENT_SECTION}\n${serialized.join("\n")}\n`;
  }

  // Determine the span of the section so keys are only matched within it.
  let sectionEnd = lines.length;
  for (let index = sectionIndex + 1; index < lines.length; index += 1) {
    if (lines[index].trim().startsWith("[")) {
      sectionEnd = index;
      break;
    }
  }

  const remaining = new Map(entries.map((entry) => [entry.key, entry.value]));
  const matcherFor = (key: string) =>
    new RegExp(
      `^(\\s*)"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"(\\s*=\\s*)"(?:[^"\\\\]|\\\\.)*"(\\s*;?\\s*)$`
    );

  // Replace values in place so CrossOver can never see two conflicting
  // statements for the same key (it does not define which would win).
  for (let index = sectionIndex + 1; index < sectionEnd; index += 1) {
    for (const [key, value] of remaining) {
      const match = matcherFor(key).exec(lines[index]);
      if (match) {
        lines[index] = `${match[1]}"${key}"${match[2]}"${value}"${match[3]}`;
        remaining.delete(key);
        break;
      }
    }
  }

  // Anything still unmatched is a new key; prepend it to the section.
  if (remaining.size > 0) {
    const serialized = serializeBottleEnvironmentEntries(
      [...remaining].map(([key, value]) => ({ key, value }))
    );
    lines.splice(sectionIndex + 1, 0, ...serialized);
  }

  return lines.join("\n");
};

/**
 * Reads a single string value from the `[EnvironmentVariables]` section.
 * Returns null when the key (or section) is absent. Only the first occurrence
 * is considered, matching CrossOver's own last-wins-per-statement parsing for
 * the keys Hydra writes.
 */
export const readBottleEnvironmentVariable = (
  content: string,
  key: string
): string | null => {
  const lines = content.split("\n");
  let inSection = false;
  const matcher = new RegExp(
    `^\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"\\s*;?\\s*$`
  );

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inSection = trimmed === ENVIRONMENT_SECTION;
      continue;
    }
    if (!inSection) continue;

    const match = matcher.exec(line);
    if (match) return match[1];
  }

  return null;
};

/** The environment keys the current settings want to control. */
export const getCrossoverSettingEnvValues = (
  settings: GameCrossoverSettings
): BottleEnvironmentEntry[] => {
  const entries: BottleEnvironmentEntry[] = [];

  if (settings.renderer !== "") {
    entries.push({
      key: CROSSOVER_SETTING_ENV_KEYS.renderer,
      value: settings.renderer,
    });
  }

  const toggle = (key: string, value: boolean | null) => {
    if (value === null) return;
    entries.push({ key, value: value ? "1" : "0" });
  };

  toggle(CROSSOVER_SETTING_ENV_KEYS.msync, settings.msync);
  toggle(CROSSOVER_SETTING_ENV_KEYS.dxvk, settings.dxvk);
  toggle(CROSSOVER_SETTING_ENV_KEYS.d3dmetal, settings.d3dmetal);
  toggle(CROSSOVER_SETTING_ENV_KEYS.metalFx, settings.metalFx);
  toggle(CROSSOVER_SETTING_ENV_KEYS.nvExtensions, settings.nvExtensions);
  toggle(CROSSOVER_SETTING_ENV_KEYS.dxr, settings.dxr);
  toggle(CROSSOVER_SETTING_ENV_KEYS.mtl4, settings.mtl4);

  return entries;
};

export const applyCrossoverSettingsToConfig = (
  content: string,
  settings: GameCrossoverSettings
): string =>
  insertEnvironmentEntries(content, getCrossoverSettingEnvValues(settings));

export interface CrossoverBottleConfig {
  configPath: string;
  content: string;
}

export const getCrossoverBottleConfigPath = (bottlePath: string) =>
  path.join(bottlePath, "cxbottle.conf");

export const readCrossoverBottleConfig = async (
  bottlePath: string
): Promise<CrossoverBottleConfig | null> => {
  const configPath = getCrossoverBottleConfigPath(bottlePath);

  try {
    const content = await fs.promises.readFile(configPath, "utf8");
    return { configPath, content };
  } catch {
    return null;
  }
};

/** Writes the config atomically so a crash can't leave a truncated bottle. */
export const writeCrossoverBottleConfig = async (
  configPath: string,
  content: string
) => {
  const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(temporaryPath, content, "utf8");
  await fs.promises.rename(temporaryPath, configPath);
};

export interface CrossoverBottleState {
  bottlePath: string;
  configPath: string;
  /** The pre-launch config, so it can be restored verbatim on exit. */
  originalContent: string;
}

/**
 * Applies the game's settings to its bottle. Returns the state needed to
 * restore the bottle afterwards, or null when there is nothing to do (no
 * settings, or the bottle has no config file). Throws only if an existing,
 * readable config could not be written.
 */
export const applyCrossoverSettingsToBottle = async (
  bottlePath: string,
  settings: GameCrossoverSettings
): Promise<CrossoverBottleState | null> => {
  const config = await readCrossoverBottleConfig(bottlePath);
  if (!config) return null;

  const updated = applyCrossoverSettingsToConfig(config.content, settings);
  if (updated === config.content) {
    // Nothing to change; still return state so the caller's map stays uniform.
    return {
      bottlePath,
      configPath: config.configPath,
      originalContent: config.content,
    };
  }

  await writeCrossoverBottleConfig(config.configPath, updated);

  return {
    bottlePath,
    configPath: config.configPath,
    originalContent: config.content,
  };
};

/**
 * Restores a bottle to exactly its pre-launch contents. Guarded by a
 * pre-launch marker comment check is unnecessary because we keep the full
 * original text; we simply write it back if the file still exists.
 */
export const restoreCrossoverBottle = async (state: CrossoverBottleState) => {
  try {
    await writeCrossoverBottleConfig(state.configPath, state.originalContent);
  } catch {
    // Best effort: the game is already exiting, and CrossOver regenerates
    // anything missing when it next runs the bottle.
  }
};

/**
 * Remembers, per game, the bottle state Hydra changed at launch so the process
 * watcher can put it back when the game exits. Games that share a bottle are
 * restored in exit order; CrossOver only reads the config at startup, so the
 * last writer wins for the next launch regardless.
 */
const pendingCrossoverBottleStates = new Map<string, CrossoverBottleState>();

export const applyCrossoverSettingsForLaunch = async (
  gameKey: string,
  bottlePath: string,
  settings: GameCrossoverSettings | null | undefined
): Promise<boolean> => {
  if (!hasAnyCrossoverSetting(settings)) return false;

  const state = await applyCrossoverSettingsToBottle(bottlePath, settings!);
  if (!state) return false;

  pendingCrossoverBottleStates.set(gameKey, state);
  return true;
};

export const restoreCrossoverSettingsForGame = async (gameKey: string) => {
  const state = pendingCrossoverBottleStates.get(gameKey);
  if (!state) return;

  pendingCrossoverBottleStates.delete(gameKey);
  await restoreCrossoverBottle(state);
};
