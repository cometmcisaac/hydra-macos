import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getGameExecutableFilters } from "./constants.js";

const labels = { executable: "Game executable", allFiles: "All files" };

describe("getGameExecutableFilters", () => {
  it("lets macOS pick native .app bundles and Windows .exe files", () => {
    const [executable, allFiles] = getGameExecutableFilters("darwin", labels);

    assert.deepEqual(executable.extensions, ["app", "exe"]);
    assert.deepEqual(allFiles.extensions, ["*"]);
  });

  it("keeps the Windows filter to Windows executables", () => {
    const filters = getGameExecutableFilters("win32", labels);

    assert.equal(filters.length, 1);
    assert.ok(filters[0].extensions.includes("exe"));
    assert.ok(!filters[0].extensions.includes("app"));
  });

  it("keeps the Linux filter with an all-files fallback", () => {
    const filters = getGameExecutableFilters("linux", labels);

    assert.ok(filters[0].extensions.includes("AppImage"));
    assert.deepEqual(filters.at(-1)?.extensions, ["*"]);
  });
});
