import { gamesSublevel, levelKeys } from "@main/level";
import { normalizeGameCrossoverSettings } from "@shared";
import type { GameShop } from "@types";
import { registerEvent } from "../register-event";

const updateGameCrossoverSettings = async (
  _event: Electron.IpcMainInvokeEvent,
  shop: GameShop,
  objectId: string,
  settings: unknown
) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) return;

  await gamesSublevel.put(gameKey, {
    ...game,
    crossoverSettings: normalizeGameCrossoverSettings(settings),
  });
};

registerEvent("updateGameCrossoverSettings", updateGameCrossoverSettings);
