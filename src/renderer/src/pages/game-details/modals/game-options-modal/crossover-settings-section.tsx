import { useTranslation } from "react-i18next";

import { SelectField } from "@renderer/components";
import {
  CROSSOVER_GRAPHICS_BACKENDS,
  CROSSOVER_SETTING_LABELS,
  type CrossoverSettingKey,
  type GameCrossoverSettings,
} from "@shared";
import "./crossover-settings-section.scss";

interface CrossoverSettingsSectionProps {
  settings: GameCrossoverSettings;
  onChange: (settings: GameCrossoverSettings) => void;
}

const TOGGLE_KEYS: Exclude<CrossoverSettingKey, "renderer">[] = [
  "msync",
  "metalFx",
  "nvExtensions",
  "dxr",
  "mtl4",
];

const toggleToValue = (value: boolean | null) =>
  value === null ? "" : value ? "1" : "0";

const valueToToggle = (value: string): boolean | null =>
  value === "" ? null : value === "1";

export function CrossoverSettingsSection({
  settings,
  onChange,
}: Readonly<CrossoverSettingsSectionProps>) {
  const { t } = useTranslation("game_details");

  const unchangedLabel = t("crossover_setting_unchanged", {
    defaultValue: "Leave unchanged",
  });
  const onLabel = t("crossover_setting_on", { defaultValue: "On" });
  const offLabel = t("crossover_setting_off", { defaultValue: "Off" });

  const toggleOptions = [
    { key: "unchanged", value: "", label: unchangedLabel },
    { key: "on", value: "1", label: onLabel },
    { key: "off", value: "0", label: offLabel },
  ];

  const rendererOptions = [
    { key: "unchanged", value: "", label: unchangedLabel },
    ...CROSSOVER_GRAPHICS_BACKENDS.map((backend) => ({
      key: backend,
      value: backend,
      label: backend,
    })),
  ];

  const update = <K extends keyof GameCrossoverSettings>(
    key: K,
    value: GameCrossoverSettings[K]
  ) => onChange({ ...settings, [key]: value });

  return (
    <div className="game-options-modal__section">
      <div className="game-options-modal__header">
        <h2>
          {t("crossover_settings", { defaultValue: "CrossOver settings" })}
        </h2>
        <h4 className="game-options-modal__header-description">
          {t("crossover_settings_description", {
            defaultValue:
              "Applied to this game's CrossOver bottle when you launch it, then restored when you exit. Choose 'Leave unchanged' to keep whatever CrossOver is set to.",
          })}
        </h4>
      </div>

      <div className="crossover-settings__grid">
        <SelectField
          theme="dark"
          label={t("crossover_setting_renderer", {
            defaultValue: CROSSOVER_SETTING_LABELS.renderer,
          })}
          value={settings.renderer}
          options={rendererOptions}
          onChange={(event) => update("renderer", event.target.value as never)}
        />

        {TOGGLE_KEYS.map((key) => (
          <SelectField
            key={key}
            theme="dark"
            label={t(`crossover_setting_${key}`, {
              defaultValue: CROSSOVER_SETTING_LABELS[key],
            })}
            value={toggleToValue(settings[key])}
            options={toggleOptions}
            onChange={(event) =>
              update(key, valueToToggle(event.target.value) as never)
            }
          />
        ))}
      </div>
    </div>
  );
}
