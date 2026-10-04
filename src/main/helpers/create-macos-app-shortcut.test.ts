import { describe, it } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildMacAppBundleIdentifier,
  buildMacAppInfoPlist,
  buildMacAppLauncherScript,
  createMacAppShortcut,
  resolveMacApplicationDirectory,
  sanitizeShortcutAppName,
} from "./create-macos-app-shortcut.ts";

const withTempDir = <T>(run: (dir: string) => T): T => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hydra-shortcut-test-"));

  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

describe("sanitizeShortcutAppName", () => {
  it("keeps ordinary game titles", () => {
    assert.strictEqual(
      sanitizeShortcutAppName("Hollow Knight"),
      "Hollow Knight"
    );
  });

  it("strips path separators and control characters", () => {
    assert.strictEqual(sanitizeShortcutAppName("A/B\\C:D"), "A B C D");
    assert.strictEqual(sanitizeShortcutAppName("bad\u0000name"), "badname");
  });

  it("collapses whitespace and falls back when empty", () => {
    assert.strictEqual(sanitizeShortcutAppName("  a   b  "), "a b");
    assert.strictEqual(sanitizeShortcutAppName("///"), "Hydra Game");
  });
});

describe("buildMacAppLauncherScript", () => {
  it("execs the target with quoted arguments", () => {
    const script = buildMacAppLauncherScript(
      "/Applications/Hydra.app/Contents/MacOS/Hydra",
      ["hydralauncher://run?shop=steam&objectId=1"]
    );

    assert.match(script, /^#!\/bin\/sh\n/);
    assert.match(
      script,
      /exec '\/Applications\/Hydra\.app\/Contents\/MacOS\/Hydra' 'hydralauncher:\/\/run\?shop=steam&objectId=1'/
    );
  });

  it("escapes single quotes in arguments", () => {
    const script = buildMacAppLauncherScript("/bin/echo", ["it's"]);
    assert.match(script, /'it'\\''s'/);
  });
});

describe("buildMacAppInfoPlist", () => {
  it("includes the executable, name and package type", () => {
    const plist = buildMacAppInfoPlist({
      bundleName: "Hollow Knight",
      bundleIdentifier: "gg.hydralauncher.shortcut.abc",
      executableName: "Hollow Knight",
      hasIcon: false,
    });

    assert.match(
      plist,
      /<key>CFBundleExecutable<\/key>\n {2}<string>Hollow Knight<\/string>/
    );
    assert.match(plist, /<string>gg\.hydralauncher\.shortcut\.abc<\/string>/);
    assert.match(plist, /<string>APPL<\/string>/);
  });

  it("adds an icon entry only when requested", () => {
    const withIcon = buildMacAppInfoPlist({
      bundleName: "Game",
      bundleIdentifier: "id",
      executableName: "Game",
      hasIcon: true,
    });
    const withoutIcon = buildMacAppInfoPlist({
      bundleName: "Game",
      bundleIdentifier: "id",
      executableName: "Game",
      hasIcon: false,
    });

    assert.match(withIcon, /CFBundleIconFile/);
    assert.doesNotMatch(withoutIcon, /CFBundleIconFile/);
  });

  it("escapes XML-significant characters in the name", () => {
    const plist = buildMacAppInfoPlist({
      bundleName: 'Tom & "Jerry" <3',
      bundleIdentifier: "id",
      executableName: "launcher",
      hasIcon: false,
    });

    assert.match(plist, /Tom &amp; &quot;Jerry&quot; &lt;3/);
    assert.doesNotMatch(plist, /"Jerry"/);
  });
});

describe("buildMacAppBundleIdentifier", () => {
  it("is deterministic for the same name", () => {
    assert.strictEqual(
      buildMacAppBundleIdentifier("Game"),
      buildMacAppBundleIdentifier("Game")
    );
  });

  it("differs when the salt differs", () => {
    assert.notStrictEqual(
      buildMacAppBundleIdentifier("Game", "a"),
      buildMacAppBundleIdentifier("Game", "b")
    );
  });
});

describe("resolveMacApplicationDirectory", () => {
  it("returns an existing directory", () => {
    const dir = resolveMacApplicationDirectory();
    assert.ok(fs.existsSync(dir));
  });
});

describe("createMacAppShortcut", () => {
  it("creates a launchable .app bundle with no icon", () =>
    withTempDir((dir) => {
      const bundlePath = createMacAppShortcut({
        appName: "Hollow Knight",
        outputDirectory: dir,
        executablePath: "/Applications/Hydra.app/Contents/MacOS/Hydra",
        arguments: ["hydralauncher://run?shop=steam&objectId=42"],
      });

      assert.strictEqual(bundlePath, path.join(dir, "Hollow Knight.app"));

      const launcherPath = path.join(
        bundlePath as string,
        "Contents",
        "MacOS",
        "Hollow Knight"
      );
      assert.ok(fs.existsSync(launcherPath));
      // Executable bit set.
      assert.ok(fs.statSync(launcherPath).mode & 0o100);
      assert.match(
        fs.readFileSync(launcherPath, "utf8"),
        /hydralauncher:\/\/run\?shop=steam&objectId=42/
      );

      const plist = fs.readFileSync(
        path.join(bundlePath as string, "Contents", "Info.plist"),
        "utf8"
      );
      assert.match(plist, /CFBundleExecutable/);
      assert.doesNotMatch(plist, /CFBundleIconFile/);
    }));

  it("copies an .icns icon into the bundle resources", () =>
    withTempDir((dir) => {
      const iconPath = path.join(dir, "source.icns");
      fs.writeFileSync(iconPath, "not-a-real-icns");

      const bundlePath = createMacAppShortcut({
        appName: "Game",
        outputDirectory: dir,
        executablePath: "/bin/true",
        arguments: ["x"],
        iconPath,
      });

      const copiedIcon = path.join(
        bundlePath as string,
        "Contents",
        "Resources",
        "appicon.icns"
      );
      assert.strictEqual(
        fs.readFileSync(copiedIcon, "utf8"),
        "not-a-real-icns"
      );

      const plist = fs.readFileSync(
        path.join(bundlePath as string, "Contents", "Info.plist"),
        "utf8"
      );
      assert.match(plist, /CFBundleIconFile/);
    }));

  it("replaces an existing bundle without throwing", () =>
    withTempDir((dir) => {
      createMacAppShortcut({
        appName: "Game",
        outputDirectory: dir,
        executablePath: "/bin/true",
        arguments: ["one"],
      });
      const second = createMacAppShortcut({
        appName: "Game",
        outputDirectory: dir,
        executablePath: "/bin/true",
        arguments: ["two"],
      });

      assert.ok(second);
      assert.match(
        fs.readFileSync(
          path.join(second as string, "Contents", "MacOS", "Game"),
          "utf8"
        ),
        /'two'/
      );
    }));
});
