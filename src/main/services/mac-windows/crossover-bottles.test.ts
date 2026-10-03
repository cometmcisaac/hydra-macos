import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import {
  isWinePrefixDirectory,
  listCrossOverBottles,
  resolveCrossOverBottleForExecutable,
} from "./crossover-bottles.js";

let sandbox: string;
let bottlesRoot: string;
let external: string;

const touch = (file: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "");
  return file;
};

const createBottle = (
  name: string,
  mappedDrives: Record<string, string> = {}
) => {
  const bottle = path.join(bottlesRoot, name);
  for (const file of ["system.reg", "user.reg", "userdef.reg"]) {
    touch(path.join(bottle, file));
  }
  fs.mkdirSync(path.join(bottle, "drive_c", "users", "crossover"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(bottle, "dosdevices"), { recursive: true });
  fs.symlinkSync("../drive_c", path.join(bottle, "dosdevices", "c:"));
  fs.symlinkSync("/", path.join(bottle, "dosdevices", "z:"));
  fs.symlinkSync("/dev/disk4s1", path.join(bottle, "dosdevices", "e::"));
  for (const [drive, target] of Object.entries(mappedDrives)) {
    fs.symlinkSync(target, path.join(bottle, "dosdevices", drive));
  }
  return fs.realpathSync(bottle);
};

describe("CrossOver bottle detection", () => {
  let steamBottle: string;
  let externalBottle: string;

  before(() => {
    sandbox = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "hydra-bottles-"))
    );
    bottlesRoot = path.join(sandbox, "CXPBottles");
    external = path.join(sandbox, "Volumes", "External");
    fs.mkdirSync(external, { recursive: true });
    fs.mkdirSync(bottlesRoot, { recursive: true });

    steamBottle = createBottle("Steam-2");
    externalBottle = createBottle("External Drive", { "d:": external });

    // Not a bottle: a plain folder, and a hidden folder with prefix files.
    fs.mkdirSync(path.join(bottlesRoot, "not-a-bottle"));
    fs.cpSync(path.join(steamBottle), path.join(bottlesRoot, ".hidden"), {
      recursive: true,
      verbatimSymlinks: true,
    });
  });

  after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  it("lists only real bottles", async () => {
    assert.deepEqual(await listCrossOverBottles([bottlesRoot]), [
      externalBottle,
      steamBottle,
    ]);
    assert.equal(await isWinePrefixDirectory(steamBottle), true);
    assert.equal(
      await isWinePrefixDirectory(path.join(bottlesRoot, "not-a-bottle")),
      false
    );
  });

  it("finds the bottle that contains the executable in its drive_c", async () => {
    const exe = touch(
      path.join(
        steamBottle,
        "drive_c/Program Files (x86)/Steam/steamapps/common/Game/game.exe"
      )
    );

    assert.deepEqual(
      await resolveCrossOverBottleForExecutable(exe, [bottlesRoot]),
      { kind: "found", bottlePath: steamBottle }
    );
  });

  it("finds a bottle through a mapped external drive", async () => {
    const exe = touch(path.join(external, "Games/Some Game/game.exe"));

    assert.deepEqual(
      await resolveCrossOverBottleForExecutable(exe, [bottlesRoot]),
      { kind: "found", bottlePath: externalBottle }
    );
  });

  it("ignores the z: -> / mapping every bottle has", async () => {
    const exe = touch(path.join(sandbox, "Downloads/Game/game.exe"));

    assert.deepEqual(
      await resolveCrossOverBottleForExecutable(exe, [bottlesRoot]),
      { kind: "none" }
    );
  });

  it("follows symlinks to the real executable location", async () => {
    const real = touch(path.join(external, "Linked/game.exe"));
    const link = path.join(sandbox, "shortcut.exe");
    fs.symlinkSync(real, link);

    assert.deepEqual(
      await resolveCrossOverBottleForExecutable(link, [bottlesRoot]),
      { kind: "found", bottlePath: externalBottle }
    );
  });

  it("reports ambiguity when two bottles map the same drive", async () => {
    const twin = createBottle("Twin", { "d:": external });
    const exe = path.join(external, "Games/Some Game/game.exe");

    const result = await resolveCrossOverBottleForExecutable(exe, [
      bottlesRoot,
    ]);
    assert.equal(result.kind, "ambiguous");
    assert.deepEqual(
      result.kind === "ambiguous" ? [...result.candidates].sort() : [],
      [externalBottle, twin].sort()
    );

    fs.rmSync(twin, { recursive: true, force: true });
  });

  it("prefers the most specific mapped folder", async () => {
    const specific = createBottle("Specific", {
      "f:": path.join(external, "Games"),
    });
    const exe = path.join(external, "Games/Some Game/game.exe");

    assert.deepEqual(
      await resolveCrossOverBottleForExecutable(exe, [bottlesRoot]),
      { kind: "found", bottlePath: specific }
    );

    fs.rmSync(specific, { recursive: true, force: true });
  });

  it("returns none when no bottle roots exist", async () => {
    assert.deepEqual(
      await resolveCrossOverBottleForExecutable("/nowhere/game.exe", [
        path.join(sandbox, "missing"),
      ]),
      { kind: "none" }
    );
  });
});
