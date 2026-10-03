import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isWindowsExecutablePath,
  resolveCloudSavePlatform,
} from "./cloud-save-platform.js";

describe("resolveCloudSavePlatform", () => {
  it("models a Windows executable on macOS as a Windows game in a prefix", () => {
    assert.equal(
      resolveCloudSavePlatform("darwin", "/Users/me/Games/Game/game.exe"),
      "linux"
    );
    assert.equal(
      resolveCloudSavePlatform("darwin", "/Users/me/Games/Game/GAME.EXE"),
      "linux"
    );
  });

  it("keeps native macOS games on the mac platform", () => {
    assert.equal(
      resolveCloudSavePlatform("darwin", "/Applications/G.app"),
      "mac"
    );
    assert.equal(resolveCloudSavePlatform("darwin", undefined), "mac");
    assert.equal(resolveCloudSavePlatform("darwin", null), "mac");
  });

  it("does not change Windows or Linux", () => {
    assert.equal(
      resolveCloudSavePlatform("win32", "C:\\Games\\g.exe"),
      "windows"
    );
    assert.equal(resolveCloudSavePlatform("linux", "/games/g.exe"), "linux");
    assert.equal(resolveCloudSavePlatform("linux", "/games/g.x86_64"), "linux");
  });

  it("only treats .exe as a Windows executable", () => {
    assert.equal(isWindowsExecutablePath("/a/b.exe"), true);
    assert.equal(isWindowsExecutablePath("/a/b.exe.app"), false);
    assert.equal(isWindowsExecutablePath(undefined), false);
  });
});
