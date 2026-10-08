import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_GAME_CROSSOVER_SETTINGS,
  type GameCrossoverSettings,
} from "../../../shared/crossover-settings.js";
import {
  applyCrossoverSettingsToConfig,
  getCrossoverSettingEnvValues,
  insertEnvironmentEntries,
  readBottleEnvironmentVariable,
} from "./crossover-settings.js";

const SAMPLE_CONFIG = `[Bottle]
"Custom Icon" = "/tmp/icon.png";

[EnvironmentVariables]
"CX_BOTTLE_CREATOR_APPID" = "com.codeweavers.c4.206"
"D3DM_ENABLE_METALFX" = "0"
"WINEDXVK" = "1"
"CX_GRAPHICS_BACKEND" = "dxmt"
"WINED3DMETAL" = "1"
"WINEMSYNC" = "0"
"DXMT_ENABLE_NVEXT" = "0"
"D3DM_SUPPORT_DXR" = "1"
"D3DM_MTL4" = "1"
;;"PROMPT" = "$p$g"

[Other]
"Keep" = "me";
`;

const settings = (
  partial: Partial<GameCrossoverSettings>
): GameCrossoverSettings => ({
  ...DEFAULT_GAME_CROSSOVER_SETTINGS,
  ...partial,
});

describe("getCrossoverSettingEnvValues", () => {
  it("maps only values that are set", () => {
    const entries = getCrossoverSettingEnvValues(
      settings({ renderer: "d3dmetal", msync: true, dxr: false })
    );

    assert.deepEqual(entries, [
      { key: "CX_GRAPHICS_BACKEND", value: "d3dmetal" },
      { key: "WINEMSYNC", value: "1" },
      { key: "D3DM_SUPPORT_DXR", value: "0" },
    ]);
  });

  it("emits nothing for all-unchanged settings", () => {
    assert.deepEqual(
      getCrossoverSettingEnvValues(DEFAULT_GAME_CROSSOVER_SETTINGS),
      []
    );
  });
});

describe("insertEnvironmentEntries", () => {
  it("replaces an existing key in place, leaving no duplicate", () => {
    const result = insertEnvironmentEntries(SAMPLE_CONFIG, [
      { key: "WINEMSYNC", value: "1" },
    ]);

    const occurrences = result.match(/"WINEMSYNC"/g) ?? [];
    assert.equal(occurrences.length, 1);
    assert.equal(readBottleEnvironmentVariable(result, "WINEMSYNC"), "1");
    // Neighbouring entries are untouched.
    assert.ok(result.includes('"CX_GRAPHICS_BACKEND" = "dxmt"'));
    assert.ok(result.includes('"PROMPT" = "$p$g"'));
  });

  it("inserts new keys at the top of the section", () => {
    const result = insertEnvironmentEntries(SAMPLE_CONFIG, [
      { key: "BRAND_NEW_KEY", value: "abc" },
    ]);

    const lines = result.split("\n");
    const sectionIndex = lines.indexOf("[EnvironmentVariables]");
    assert.equal(lines[sectionIndex + 1], '"BRAND_NEW_KEY" = "abc";');
    assert.ok(result.includes('"CX_GRAPHICS_BACKEND" = "dxmt"'));
  });

  it("creates the section when missing", () => {
    const result = insertEnvironmentEntries('[Bottle]\n"X" = "y";\n', [
      { key: "WINEMSYNC", value: "0" },
    ]);

    assert.ok(result.includes("[EnvironmentVariables]"));
    assert.ok(result.includes('"WINEMSYNC" = "0";'));
  });

  it("returns content unchanged for no entries", () => {
    assert.equal(insertEnvironmentEntries(SAMPLE_CONFIG, []), SAMPLE_CONFIG);
  });
});

describe("readBottleEnvironmentVariable", () => {
  it("reads a present key", () => {
    assert.equal(
      readBottleEnvironmentVariable(SAMPLE_CONFIG, "CX_GRAPHICS_BACKEND"),
      "dxmt"
    );
    assert.equal(
      readBottleEnvironmentVariable(SAMPLE_CONFIG, "WINEMSYNC"),
      "0"
    );
  });

  it("ignores commented-out lines", () => {
    assert.equal(readBottleEnvironmentVariable(SAMPLE_CONFIG, "PROMPT"), null);
  });

  it("returns null for an absent key", () => {
    assert.equal(readBottleEnvironmentVariable(SAMPLE_CONFIG, "NOPE"), null);
  });
});

describe("applyCrossoverSettingsToConfig", () => {
  it("replaces existing values, readable back, without duplicating keys", () => {
    const updated = applyCrossoverSettingsToConfig(
      SAMPLE_CONFIG,
      settings({ msync: true, renderer: "wined3d" })
    );

    assert.equal(readBottleEnvironmentVariable(updated, "WINEMSYNC"), "1");
    assert.equal(
      readBottleEnvironmentVariable(updated, "CX_GRAPHICS_BACKEND"),
      "wined3d"
    );
    assert.equal((updated.match(/"WINEMSYNC"/g) ?? []).length, 1);
    assert.equal((updated.match(/"CX_GRAPHICS_BACKEND"/g) ?? []).length, 1);
  });
});
