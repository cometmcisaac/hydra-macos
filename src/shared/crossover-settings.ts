/**
 * Per-game CrossOver settings.
 *
 * CrossOver reads these from the bottle's `cxbottle.conf`
 * (`[EnvironmentVariables]`) at launch and overwrites whatever Hydra passes on
 * the command line, so Hydra applies a game's choices by editing that file just
 * before launch and restoring the original values when the game exits.
 *
 * A `null` value means "don't touch this key" — the bottle's own setting (which
 * the user may have changed in CrossOver itself) is left alone. `renderer` uses
 * an empty string for the same meaning.
 */
export interface GameCrossoverSettings {
  /** CX_GRAPHICS_BACKEND. */
  renderer: CrossoverGraphicsBackend | "";
  /** WINEMSYNC */
  msync: boolean | null;
  /** D3DM_ENABLE_METALFX */
  metalFx: boolean | null;
  /** DXMT_ENABLE_NVEXT */
  nvExtensions: boolean | null;
  /** D3DM_SUPPORT_DXR */
  dxr: boolean | null;
  /** D3DM_MTL4 */
  mtl4: boolean | null;
}

export type CrossoverGraphicsBackend = "dxmt" | "d3dmetal" | "dxvk" | "wined3d";

export const CROSSOVER_GRAPHICS_BACKENDS: CrossoverGraphicsBackend[] = [
  "dxmt",
  "d3dmetal",
  "dxvk",
  "wined3d",
];

export const CROSSOVER_GRAPHICS_BACKEND_ENV = "CX_GRAPHICS_BACKEND";

/** Maps each setting to the CrossOver environment variable it controls. */
export const CROSSOVER_SETTING_ENV_KEYS = {
  renderer: CROSSOVER_GRAPHICS_BACKEND_ENV,
  msync: "WINEMSYNC",
  metalFx: "D3DM_ENABLE_METALFX",
  nvExtensions: "DXMT_ENABLE_NVEXT",
  dxr: "D3DM_SUPPORT_DXR",
  mtl4: "D3DM_MTL4",
} as const satisfies Record<keyof GameCrossoverSettings, string>;

export type CrossoverSettingKey = keyof GameCrossoverSettings;

export const DEFAULT_GAME_CROSSOVER_SETTINGS: GameCrossoverSettings = {
  renderer: "",
  msync: null,
  metalFx: null,
  nvExtensions: null,
  dxr: null,
  mtl4: null,
};

export const hasAnyCrossoverSetting = (
  settings: GameCrossoverSettings | null | undefined
): boolean => {
  if (!settings) return false;

  return (
    settings.renderer !== "" ||
    settings.msync !== null ||
    settings.metalFx !== null ||
    settings.nvExtensions !== null ||
    settings.dxr !== null ||
    settings.mtl4 !== null
  );
};

/**
 * Keeps only values of the expected shape so a malformed record can never break
 * the launch path or write junk into a bottle.
 */
export const normalizeGameCrossoverSettings = (
  value: unknown
): GameCrossoverSettings => {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};

  const asToggle = (raw: unknown): boolean | null =>
    typeof raw === "boolean" ? raw : null;

  const renderer = CROSSOVER_GRAPHICS_BACKENDS.includes(
    input.renderer as CrossoverGraphicsBackend
  )
    ? (input.renderer as CrossoverGraphicsBackend)
    : "";

  return {
    renderer,
    msync: asToggle(input.msync),
    metalFx: asToggle(input.metalFx),
    nvExtensions: asToggle(input.nvExtensions),
    dxr: asToggle(input.dxr),
    mtl4: asToggle(input.mtl4),
  };
};

export const CROSSOVER_SETTING_LABELS: Record<CrossoverSettingKey, string> = {
  renderer: "Graphics backend (renderer)",
  msync: "MSync",
  metalFx: "MetalFX",
  nvExtensions: "NVIDIA extensions (DXMT)",
  dxr: "Ray tracing (DXR)",
  mtl4: "Metal 4 (MTL4)",
};
