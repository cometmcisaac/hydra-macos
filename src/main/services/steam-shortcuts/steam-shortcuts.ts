import { dialog, shell } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { logger } from "../logger";
import { getSteamLocation } from "../steam";
import { getSteamStoreUserContext } from "../steam-login-users";
import { SystemPath } from "../system-path";
import {
  NOTPROTON_TOOL_NAME,
  createEmptyShortcutsFile,
  getCompatToolMapping,
  getHydraShortcutAppId,
  getShortcutLaunchUrl,
  parseShortcutsFile,
  serializeShortcutsFile,
  upsertCompatToolMapping,
  upsertShortcut,
} from "./steam-shortcuts-core";

const execFileAsync = promisify(execFile);

const STEAM_PROCESS_NAME = "steam_osx";
const STEAM_QUIT_TIMEOUT_MS = 45_000;
const STEAM_POLL_INTERVAL_MS = 500;
const MAX_BACKUPS = 10;

export interface SteamShortcutRequest {
  shop: string;
  objectId: string;
  title: string;
  executablePath: string;
  launchOptions?: string | null;
}

interface SteamFiles {
  steamPath: string;
  shortcutsPath: string;
  configPath: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Only one registration/restart at a time, so two quick Play clicks cannot race.
let queue: Promise<unknown> = Promise.resolve();
const serialized = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};

const isSteamRunning = async (): Promise<boolean> => {
  try {
    await execFileAsync("pgrep", ["-x", STEAM_PROCESS_NAME]);
    return true;
  } catch {
    // pgrep exits 1 when there is no match
    return false;
  }
};

const quitSteam = async () => {
  await shell.openExternal("steam://exit");

  const deadline = Date.now() + STEAM_QUIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (!(await isSteamRunning())) {
      // Give Steam a moment to finish flushing its config files to disk.
      await sleep(1_500);
      return;
    }
    await sleep(STEAM_POLL_INTERVAL_MS);
  }

  throw new Error("Steam did not quit in time");
};

const resolveUserdataAccountFolder = async (steamPath: string) => {
  const context = await getSteamStoreUserContext(steamPath).catch(() => null);
  const userdata = path.join(steamPath, "userdata");

  if (context?.active?.accountId32) {
    return path.join(userdata, context.active.accountId32);
  }

  // Fall back to the account folder Steam touched most recently.
  const entries = await fs.promises
    .readdir(userdata, { withFileTypes: true })
    .catch(() => []);

  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && /^[1-9]\d*$/.test(entry.name))
      .map(async (entry) => {
        const folder = path.join(userdata, entry.name);
        const stats = await fs.promises
          .stat(path.join(folder, "config", "localconfig.vdf"))
          .catch(() => null);
        return { folder, modified: stats?.mtimeMs ?? 0 };
      })
  );

  candidates.sort((left, right) => right.modified - left.modified);
  return candidates[0]?.folder ?? null;
};

const resolveSteamFiles = async (): Promise<SteamFiles> => {
  const steamPath = await getSteamLocation().catch(() => null);
  if (!steamPath || !fs.existsSync(steamPath)) {
    throw new Error("Steam installation not found");
  }

  const accountFolder = await resolveUserdataAccountFolder(steamPath);
  if (!accountFolder) {
    throw new Error(
      "No Steam account found. Open Steam and sign in at least once."
    );
  }

  const configPath = path.join(steamPath, "config", "config.vdf");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Steam config not found at ${configPath}`);
  }

  return {
    steamPath,
    configPath,
    shortcutsPath: path.join(accountFolder, "config", "shortcuts.vdf"),
  };
};

const backupFiles = async (files: SteamFiles) => {
  const root = path.join(
    SystemPath.getPath("userData"),
    "steam-shortcuts-backups"
  );
  const folder = path.join(root, new Date().toISOString().replaceAll(":", "-"));
  await fs.promises.mkdir(folder, { recursive: true });

  for (const source of [files.shortcutsPath, files.configPath]) {
    if (fs.existsSync(source)) {
      await fs.promises.copyFile(
        source,
        path.join(folder, path.basename(source))
      );
    }
  }

  const backups = (await fs.promises.readdir(root)).sort();
  for (const stale of backups.slice(
    0,
    Math.max(0, backups.length - MAX_BACKUPS)
  )) {
    await fs.promises.rm(path.join(root, stale), {
      recursive: true,
      force: true,
    });
  }
};

const writeAtomically = async (filePath: string, data: Buffer | string) => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });

  const temporaryPath = `${filePath}.hydra-tmp`;
  const mode = await fs.promises
    .stat(filePath)
    .then((stats) => stats.mode)
    .catch(() => undefined);

  await fs.promises.writeFile(temporaryPath, data, { mode });
  await fs.promises.rename(temporaryPath, filePath);
};

interface Plan {
  appId: number;
  launchUrl: string;
  shortcutsBuffer: Buffer | null;
  configContent: string | null;
}

/** Works out what (if anything) has to change, without writing anything. */
const planChanges = async (
  files: SteamFiles,
  request: SteamShortcutRequest
): Promise<Plan> => {
  const appId = getHydraShortcutAppId(request.shop, request.objectId);
  const launchUrl = getShortcutLaunchUrl(appId);

  const existingShortcuts = await fs.promises
    .readFile(files.shortcutsPath)
    .catch(() => null);
  const root = existingShortcuts
    ? parseShortcutsFile(existingShortcuts)
    : createEmptyShortcutsFile();

  const shortcutChanged = upsertShortcut(root, {
    appId,
    appName: request.title,
    executablePath: request.executablePath,
    startDir: path.dirname(request.executablePath),
    launchOptions: request.launchOptions?.trim() ?? "",
  });

  const config = await fs.promises.readFile(files.configPath, "utf8");
  const mappingChanged =
    getCompatToolMapping(config, appId) !== NOTPROTON_TOOL_NAME;
  const nextConfig = mappingChanged
    ? upsertCompatToolMapping(config, appId, NOTPROTON_TOOL_NAME)
    : config;

  if (nextConfig === null) {
    throw new Error(
      "Steam's config.vdf has an unexpected structure; not modifying it"
    );
  }

  return {
    appId,
    launchUrl,
    shortcutsBuffer:
      shortcutChanged || !existingShortcuts
        ? serializeShortcutsFile(root)
        : null,
    configContent: mappingChanged ? nextConfig : null,
  };
};

const confirmSteamRestart = async (title: string) => {
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Restart Steam and launch", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    message: `Hydra needs to add "${title}" to Steam`,
    detail:
      "Steam only reads its shortcut list at startup, so Steam will be closed, updated and relaunched once. This only happens the first time a game is launched or when its executable or launch options change.",
  });

  return response === 0;
};

/**
 * Launches a Windows executable on macOS through Steam Play (NotProton) by
 * registering it as a non-Steam shortcut mapped to the NotProton tool, then
 * opening its steam://rungameid URL.
 *
 * Returns false if the user cancelled the Steam restart.
 */
export const launchWindowsGameThroughSteam = (
  request: SteamShortcutRequest
): Promise<boolean> =>
  serialized(async () => {
    const files = await resolveSteamFiles();
    const plan = await planChanges(files, request);

    if (plan.shortcutsBuffer || plan.configContent) {
      if (await isSteamRunning()) {
        if (!(await confirmSteamRestart(request.title))) return false;
        await quitSteam();
      }

      await backupFiles(files);

      // Config first: a shortcut without a mapping is the worse half-state.
      if (plan.configContent !== null) {
        await writeAtomically(files.configPath, plan.configContent);
      }
      if (plan.shortcutsBuffer) {
        await writeAtomically(files.shortcutsPath, plan.shortcutsBuffer);
      }

      logger.info("[SteamShortcuts] Registered game with Steam", {
        shop: request.shop,
        objectId: request.objectId,
        appId: plan.appId,
      });
    }

    // Starts Steam first if it is not running (e.g. we just restarted it).
    await shell.openExternal(plan.launchUrl);
    return true;
  });
