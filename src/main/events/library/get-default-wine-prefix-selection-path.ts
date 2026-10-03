import fs from "node:fs";

import { logger, Wine } from "@main/services";
import { getDefaultCrossOverBottleRoots } from "@main/services/mac-windows/crossover-bottles";
import { registerEvent } from "../register-event";

const getDefaultWinePrefixSelectionPath = async (
  _event: Electron.IpcMainInvokeEvent
) => {
  try {
    // On macOS the prefix is a CrossOver bottle, so open the picker there.
    if (process.platform === "darwin") {
      return (
        getDefaultCrossOverBottleRoots().find((root) => fs.existsSync(root)) ??
        null
      );
    }

    return Wine.getDefaultPrefixPath();
  } catch (err) {
    logger.error("Failed to get default wine prefix selection path", err);

    return null;
  }
};

registerEvent(
  "getDefaultWinePrefixSelectionPath",
  getDefaultWinePrefixSelectionPath
);
