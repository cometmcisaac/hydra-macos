import assert from "node:assert/strict";
import zlib from "node:zlib";
import { describe, it } from "node:test";

import {
  NOTPROTON_TOOL_NAME,
  createEmptyShortcutsFile,
  crc32,
  getCompatToolMapping,
  getHydraShortcutAppId,
  getShortcutLaunchId,
  getShortcutLaunchUrl,
  listShortcuts,
  parseShortcutsFile,
  serializeShortcutsFile,
  upsertCompatToolMapping,
  upsertShortcut,
  type HydraShortcut,
} from "./steam-shortcuts-core.ts";

const shortcut = (overrides: Partial<HydraShortcut> = {}): HydraShortcut => ({
  appId: getHydraShortcutAppId("custom", "game-1"),
  appName: "Some Game",
  executablePath: "/Users/me/Games/Some Game/game.exe",
  startDir: "/Users/me/Games/Some Game",
  launchOptions: "",
  ...overrides,
});

describe("crc32 and app ids", () => {
  it("matches the standard check value and zlib", () => {
    assert.equal(crc32("123456789"), 0xcbf43926);
    assert.equal(crc32("hydra:custom:abc"), zlib.crc32("hydra:custom:abc"));
  });

  it("always sets the high bit and is stable per game", () => {
    const appId = getHydraShortcutAppId("custom", "game-1");
    assert.ok(appId >= 0x80000000 && appId <= 0xffffffff);
    assert.equal(appId, getHydraShortcutAppId("custom", "game-1"));
    assert.notEqual(appId, getHydraShortcutAppId("custom", "game-2"));
  });

  it("builds the 64-bit rungameid for a shortcut", () => {
    assert.equal(
      getShortcutLaunchId(0x80000000),
      ((0x80000000n << 32n) | 0x02000000n).toString()
    );
    assert.equal(
      getShortcutLaunchUrl(0xdeadbeef),
      `steam://rungameid/${((0xdeadbeefn << 32n) | 0x02000000n).toString()}`
    );
  });
});

describe("shortcuts.vdf", () => {
  it("round-trips byte for byte, including fields we do not model", () => {
    const root = createEmptyShortcutsFile();
    upsertShortcut(root, shortcut());
    const first = serializeShortcutsFile(root);

    assert.ok(first.equals(serializeShortcutsFile(parseShortcutsFile(first))));
    assert.equal(first[0], 0x00);
    assert.equal(first.at(-1), 0x08);
    assert.equal(first.at(-2), 0x08);

    const withRaw = Buffer.concat([
      Buffer.from([0x00]),
      Buffer.from("shortcuts\0"),
      Buffer.from([0x00]),
      Buffer.from("0\0"),
      Buffer.from([0x07]),
      Buffer.from("big\0"),
      Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
      Buffer.from([0x03]),
      Buffer.from("ratio\0"),
      Buffer.from([0, 0, 128, 63]),
      Buffer.from([0x08, 0x08, 0x08]),
    ]);
    assert.ok(
      withRaw.equals(serializeShortcutsFile(parseShortcutsFile(withRaw)))
    );
  });

  it("adds new shortcuts after existing ones without touching them", () => {
    const root = createEmptyShortcutsFile();
    assert.equal(upsertShortcut(root, shortcut({ appId: 0x80000001 })), true);
    assert.equal(
      upsertShortcut(root, shortcut({ appId: 0x80000002, appName: "Other" })),
      true
    );

    const parsed = parseShortcutsFile(serializeShortcutsFile(root));
    assert.deepEqual(
      listShortcuts(parsed).map((entry) => [entry.appId, entry.appName]),
      [
        [0x80000001, "Some Game"],
        [0x80000002, "Other"],
      ]
    );
    assert.equal(
      listShortcuts(parsed)[0].executablePath,
      "/Users/me/Games/Some Game/game.exe"
    );
  });

  it("is idempotent and updates the same entry when the executable changes", () => {
    const root = createEmptyShortcutsFile();
    upsertShortcut(root, shortcut());
    assert.equal(upsertShortcut(root, shortcut()), false);

    assert.equal(
      upsertShortcut(
        root,
        shortcut({
          executablePath: "/Games/new/game.exe",
          startDir: "/Games/new",
        })
      ),
      true
    );

    const entries = listShortcuts(
      parseShortcutsFile(serializeShortcutsFile(root))
    );
    assert.equal(entries.length, 1);
    assert.equal(entries[0].executablePath, "/Games/new/game.exe");
  });

  it("handles a missing shortcuts section", () => {
    const root = parseShortcutsFile(Buffer.from([0x08]));
    assert.equal(upsertShortcut(root, shortcut()), true);
    assert.equal(listShortcuts(root).length, 1);
  });

  it("rejects truncated files instead of guessing", () => {
    const bytes = serializeShortcutsFile(
      (() => {
        const root = createEmptyShortcutsFile();
        upsertShortcut(root, shortcut());
        return root;
      })()
    );
    assert.throws(() =>
      parseShortcutsFile(bytes.subarray(0, bytes.length - 6))
    );
  });
});

const CONFIG = [
  '"InstallConfigStore"',
  "{",
  '\t"Software"',
  "\t{",
  '\t\t"Valve"',
  "\t\t{",
  '\t\t\t"Steam"',
  "\t\t\t{",
  '\t\t\t\t"AutoUpdateWindowStart"\t\t"-1"',
  "%MAPPING%",
  '\t\t\t\t"LastPlayedTimesSyncTime"\t\t"1"',
  "\t\t\t}",
  "\t\t}",
  "\t}",
  "}",
  "",
].join("\n");

const withMapping = (mapping: string) => CONFIG.replace("%MAPPING%\n", mapping);

describe("config.vdf CompatToolMapping", () => {
  const appId = 0x80000010;

  it("creates the CompatToolMapping block when it is missing", () => {
    const result = upsertCompatToolMapping(withMapping(""), appId);
    assert.ok(result);
    assert.equal(getCompatToolMapping(result, appId), NOTPROTON_TOOL_NAME);
    assert.match(result, /"CompatToolMapping"/);
    assert.match(result, /"priority"\t\t"250"/);
    assert.match(result, /"AutoUpdateWindowStart"\t\t"-1"/);
    assert.match(result, /"LastPlayedTimesSyncTime"\t\t"1"/);
  });

  it("adds to an existing block without disturbing other apps", () => {
    const existing = [
      '\t\t\t\t"CompatToolMapping"',
      "\t\t\t\t{",
      '\t\t\t\t\t"730"',
      "\t\t\t\t\t{",
      '\t\t\t\t\t\t"name"\t\t"proton_9"',
      '\t\t\t\t\t\t"config"\t\t""',
      '\t\t\t\t\t\t"priority"\t\t"250"',
      "\t\t\t\t\t}",
      "\t\t\t\t}",
      "",
    ].join("\n");

    const result = upsertCompatToolMapping(withMapping(existing), appId);
    assert.ok(result);
    assert.equal(getCompatToolMapping(result, 730), "proton_9");
    assert.equal(getCompatToolMapping(result, appId), NOTPROTON_TOOL_NAME);
  });

  it("replaces an existing mapping for the same app and is idempotent", () => {
    const first = upsertCompatToolMapping(withMapping(""), appId, "proton_9");
    assert.ok(first);
    assert.equal(getCompatToolMapping(first, appId), "proton_9");

    const second = upsertCompatToolMapping(first, appId);
    assert.ok(second);
    assert.equal(getCompatToolMapping(second, appId), NOTPROTON_TOOL_NAME);
    assert.equal(second.match(new RegExp(`"${appId}"`, "g"))?.length, 1);

    assert.equal(upsertCompatToolMapping(second, appId), second);
  });

  it("refuses to edit a file without the expected structure", () => {
    assert.equal(upsertCompatToolMapping('"Other"\n{\n}\n', appId), null);
    assert.equal(upsertCompatToolMapping("", appId), null);
  });

  it("throws on malformed input so callers never write it back", () => {
    assert.throws(() =>
      upsertCompatToolMapping('"InstallConfigStore" {', appId)
    );
  });
});
