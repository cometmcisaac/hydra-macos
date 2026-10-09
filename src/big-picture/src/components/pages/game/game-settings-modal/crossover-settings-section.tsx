import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import {
  CROSSOVER_GRAPHICS_BACKENDS,
  CROSSOVER_SETTING_LABELS,
  normalizeGameCrossoverSettings,
  supportsAppleRayTracing,
  type CrossoverSettingKey,
  type GameCrossoverSettings,
} from "@shared";
import type { LibraryGame } from "@types";
import { DropdownSelect, VerticalFocusGroup } from "../../../common";
import { SettingsSection } from "../../../../pages/settings/settings-section";

const CROSSOVER_SETTINGS_PREFIX = "game-compatibility-settings-crossover";

function getCrossoverSettingFocusId(setting: string) {
  return `${CROSSOVER_SETTINGS_PREFIX}-${setting.replaceAll(/[^a-z0-9_-]/gi, "-").toLowerCase()}`;
}

const TOGGLE_KEYS: Exclude<CrossoverSettingKey, "renderer">[] = [
  "msync",
  "metalFx",
  "nvExtensions",
  "dxr",
  "mtl4",
];

const UNCHANGED = "";
const ENABLED = "1";
const DISABLED = "0";

const toggleToValue = (value: boolean | null) =>
  value === null ? UNCHANGED : value ? ENABLED : DISABLED;

const valueToToggle = (value: string): boolean | null =>
  value === UNCHANGED ? null : value === ENABLED;

type ElectronCrossoverBridge = Pick<
  Electron,
  "updateGameCrossoverSettings" | "cpuModel"
>;

interface GameCrossoverSettingsSectionProps {
  game: LibraryGame;
  settings: GameCrossoverSettings;
  onChange: (settings: GameCrossoverSettings) => void;
}

export function GameCrossoverSettingsSection({
  game,
  settings,
  onChange,
}: Readonly<GameCrossoverSettingsSectionProps>) {
  const { t } = useTranslation("game_details");
  const electron = globalThis.window
    .electron as unknown as ElectronCrossoverBridge;

  // Hardware ray tracing needs Apple silicon M3 or newer; hide the control
  // entirely on older Macs rather than offering something that cannot work.
  const rayTracingSupported = supportsAppleRayTracing(electron.cpuModel ?? "");
  const visibleToggleKeys = useMemo(
    () => TOGGLE_KEYS.filter((key) => key !== "dxr" || rayTracingSupported),
    [rayTracingSupported]
  );

  const unchangedLabel = t("crossover_setting_unchanged", {
    defaultValue: "Leave unchanged",
  });
  const onLabel = t("crossover_setting_on", { defaultValue: "On" });
  const offLabel = t("crossover_setting_off", { defaultValue: "Off" });

  const toggleOptions = useMemo(
    () => [
      { value: UNCHANGED, label: unchangedLabel },
      { value: ENABLED, label: onLabel },
      { value: DISABLED, label: offLabel },
    ],
    [unchangedLabel, onLabel, offLabel]
  );

  const rendererOptions = useMemo(
    () => [
      { value: UNCHANGED, label: unchangedLabel },
      ...CROSSOVER_GRAPHICS_BACKENDS.map((backend) => ({
        value: backend,
        label: backend,
      })),
    ],
    [unchangedLabel]
  );

  const persist = useCallback(
    (patch: Partial<GameCrossoverSettings>) => {
      const next = normalizeGameCrossoverSettings({ ...settings, ...patch });
      void electron.updateGameCrossoverSettings(game.shop, game.objectId, next);
      onChange(next);
    },
    [electron, game.shop, game.objectId, onChange, settings]
  );

  return (
    <SettingsSection
      className="game-compatibility-settings-tab__section"
      title={t("crossover_settings", { defaultValue: "CrossOver settings" })}
      description={t("crossover_settings_description", {
        defaultValue:
          "Applied to this game's CrossOver bottle when you launch it, then restored when you exit. Choose 'Leave unchanged' to keep whatever CrossOver is set to.",
      })}
    >
      <VerticalFocusGroup className="game-crossover-settings__fields">
        <DropdownSelect
          label={t("crossover_setting_renderer", {
            defaultValue: CROSSOVER_SETTING_LABELS.renderer,
          })}
          value={settings.renderer}
          options={rendererOptions}
          onValueChange={(value) => {
            persist({ renderer: value as GameCrossoverSettings["renderer"] });
          }}
          focusId={getCrossoverSettingFocusId("renderer")}
        />

        {visibleToggleKeys.map((key) => (
          <DropdownSelect
            key={key}
            label={t(`crossover_setting_${key}`, {
              defaultValue: CROSSOVER_SETTING_LABELS[key],
            })}
            value={toggleToValue(settings[key])}
            options={toggleOptions}
            onValueChange={(value) => {
              persist({ [key]: valueToToggle(value) });
            }}
            focusId={getCrossoverSettingFocusId(key)}
          />
        ))}
      </VerticalFocusGroup>
    </SettingsSection>
  );
}
