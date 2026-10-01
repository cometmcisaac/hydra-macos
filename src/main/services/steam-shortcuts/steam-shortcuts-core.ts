/**
 * Pure helpers for registering a game as a non-Steam shortcut and mapping it to
 * a Steam Play compatibility tool (NotProton on macOS). Nothing here touches the
 * filesystem or Electron so it can be unit tested.
 */

export const NOTPROTON_TOOL_NAME = "notproton";
export const COMPAT_MAPPING_APP_PRIORITY = 250;

// ---------------------------------------------------------------------------
// crc32 + app ids
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export const crc32 = (input: string | Uint8Array): number => {
  const bytes =
    typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

/**
 * Stable 32-bit shortcut app id for a Hydra game. It is derived from the Hydra
 * game identity rather than from the executable path, so the Steam Play prefix
 * (compatdata/<appid>) survives the executable being moved or replaced.
 */
export const getHydraShortcutAppId = (shop: string, objectId: string): number =>
  (crc32(`hydra:${shop}:${objectId}`) | 0x80000000) >>> 0;

/** The 64-bit id used by `steam://rungameid/` for a non-Steam shortcut. */
export const getShortcutLaunchId = (appId: number): string =>
  ((BigInt(appId >>> 0) << 32n) | 0x02000000n).toString();

export const getShortcutLaunchUrl = (appId: number): string =>
  `steam://rungameid/${getShortcutLaunchId(appId)}`;

// ---------------------------------------------------------------------------
// Binary KeyValues (shortcuts.vdf)
// ---------------------------------------------------------------------------

export type KvValue =
  | { type: "map"; entries: KvEntry[] }
  | { type: "string"; value: string }
  | { type: "int32"; value: number }
  // Types we do not interpret (float, uint64, ...) are kept byte-for-byte.
  | { type: "raw"; typeByte: number; bytes: Buffer };

export interface KvEntry {
  key: string;
  value: KvValue;
}

const T_MAP = 0x00;
const T_STRING = 0x01;
const T_INT32 = 0x02;
const T_FLOAT = 0x03;
const T_UINT64 = 0x07;
const T_END = 0x08;
const T_INT64 = 0x0a;

const RAW_SIZES: Record<number, number> = {
  [T_FLOAT]: 4,
  [T_UINT64]: 8,
  [T_INT64]: 8,
};

class Reader {
  pos = 0;
  constructor(readonly buf: Buffer) {}

  byte() {
    if (this.pos >= this.buf.length) throw new Error("Unexpected end of file");
    return this.buf[this.pos++];
  }

  cstring() {
    const end = this.buf.indexOf(0, this.pos);
    if (end === -1) throw new Error("Unterminated string");
    const value = this.buf.toString("utf8", this.pos, end);
    this.pos = end + 1;
    return value;
  }

  take(length: number) {
    if (this.pos + length > this.buf.length) {
      throw new Error("Unexpected end of file");
    }
    const bytes = this.buf.subarray(this.pos, this.pos + length);
    this.pos += length;
    return bytes;
  }
}

const readMap = (reader: Reader): KvEntry[] => {
  const entries: KvEntry[] = [];

  for (;;) {
    const type = reader.byte();
    if (type === T_END) return entries;

    const key = reader.cstring();

    if (type === T_MAP) {
      entries.push({ key, value: { type: "map", entries: readMap(reader) } });
    } else if (type === T_STRING) {
      entries.push({ key, value: { type: "string", value: reader.cstring() } });
    } else if (type === T_INT32) {
      entries.push({
        key,
        value: { type: "int32", value: reader.take(4).readUInt32LE(0) },
      });
    } else if (RAW_SIZES[type] !== undefined) {
      entries.push({
        key,
        value: {
          type: "raw",
          typeByte: type,
          bytes: Buffer.from(reader.take(RAW_SIZES[type])),
        },
      });
    } else {
      throw new Error(
        `Unsupported binary KeyValues type 0x${type.toString(16)}`
      );
    }
  }
};

export const parseShortcutsFile = (buffer: Buffer): KvEntry[] =>
  readMap(new Reader(buffer));

const writeMap = (entries: KvEntry[], out: Buffer[]) => {
  for (const { key, value } of entries) {
    const keyBytes = Buffer.concat([
      Buffer.from(key, "utf8"),
      Buffer.from([0]),
    ]);

    if (value.type === "map") {
      out.push(Buffer.from([T_MAP]), keyBytes);
      writeMap(value.entries, out);
    } else if (value.type === "string") {
      out.push(
        Buffer.from([T_STRING]),
        keyBytes,
        Buffer.from(value.value, "utf8"),
        Buffer.from([0])
      );
    } else if (value.type === "int32") {
      const number = Buffer.alloc(4);
      number.writeUInt32LE(value.value >>> 0);
      out.push(Buffer.from([T_INT32]), keyBytes, number);
    } else {
      out.push(Buffer.from([value.typeByte]), keyBytes, value.bytes);
    }
  }

  out.push(Buffer.from([T_END]));
};

export const serializeShortcutsFile = (root: KvEntry[]): Buffer => {
  const out: Buffer[] = [];
  writeMap(root, out);
  return Buffer.concat(out);
};

export const createEmptyShortcutsFile = (): KvEntry[] => [
  { key: "shortcuts", value: { type: "map", entries: [] } },
];

const str = (key: string, value: string): KvEntry => ({
  key,
  value: { type: "string", value },
});

const int = (key: string, value: number): KvEntry => ({
  key,
  value: { type: "int32", value },
});

const findEntry = (entries: KvEntry[], key: string) =>
  entries.find((entry) => entry.key.toLowerCase() === key.toLowerCase());

const setString = (entries: KvEntry[], key: string, value: string) => {
  const existing = findEntry(entries, key);
  if (existing) {
    existing.value = { type: "string", value };
  } else {
    entries.push(str(key, value));
  }
};

export interface HydraShortcut {
  appId: number;
  appName: string;
  executablePath: string;
  startDir: string;
  launchOptions: string;
}

const quote = (value: string) => `"${value}"`;
const unquote = (value: string) => value.replace(/^"(.*)"$/, "$1");

const getEntryString = (entries: KvEntry[], key: string) => {
  const value = findEntry(entries, key)?.value;
  return value?.type === "string" ? value.value : undefined;
};

const getEntryInt = (entries: KvEntry[], key: string) => {
  const value = findEntry(entries, key)?.value;
  return value?.type === "int32" ? value.value : undefined;
};

const buildNewShortcut = (shortcut: HydraShortcut): KvEntry[] => [
  int("appid", shortcut.appId),
  str("AppName", shortcut.appName),
  str("Exe", quote(shortcut.executablePath)),
  str("StartDir", quote(shortcut.startDir)),
  str("icon", ""),
  str("ShortcutPath", ""),
  str("LaunchOptions", shortcut.launchOptions),
  int("IsHidden", 0),
  int("AllowDesktopConfig", 1),
  int("AllowOverlay", 1),
  int("OpenVR", 0),
  int("Devkit", 0),
  str("DevkitGameID", ""),
  int("DevkitOverrideAppID", 0),
  int("LastPlayTime", 0),
  str("FlatpakAppID", ""),
  {
    key: "tags",
    value: { type: "map", entries: [str("0", "Hydra")] },
  },
];

const getShortcutMap = (root: KvEntry[]): KvEntry[] => {
  let shortcuts = findEntry(root, "shortcuts");

  if (!shortcuts || shortcuts.value.type !== "map") {
    shortcuts = { key: "shortcuts", value: { type: "map", entries: [] } };
    root.push(shortcuts);
  }

  return (shortcuts.value as { type: "map"; entries: KvEntry[] }).entries;
};

/**
 * Adds the shortcut, or updates the entry with the same app id in place so any
 * fields the user or Steam added (artwork, tags, ...) are kept.
 * Returns whether anything changed.
 */
export const upsertShortcut = (
  root: KvEntry[],
  shortcut: HydraShortcut
): boolean => {
  const shortcuts = getShortcutMap(root);
  const existing = shortcuts.find(
    (entry) =>
      entry.value.type === "map" &&
      getEntryInt(entry.value.entries, "appid") === shortcut.appId
  );

  if (!existing || existing.value.type !== "map") {
    const indexes = shortcuts
      .map((entry) => Number(entry.key))
      .filter((index) => Number.isInteger(index));
    const nextIndex = indexes.length > 0 ? Math.max(...indexes) + 1 : 0;

    shortcuts.push({
      key: String(nextIndex),
      value: { type: "map", entries: buildNewShortcut(shortcut) },
    });
    return true;
  }

  const entries = existing.value.entries;
  const desired: Array<[string, string]> = [
    ["AppName", shortcut.appName],
    ["Exe", quote(shortcut.executablePath)],
    ["StartDir", quote(shortcut.startDir)],
    ["LaunchOptions", shortcut.launchOptions],
  ];

  let changed = false;
  for (const [key, value] of desired) {
    if (getEntryString(entries, key) !== value) {
      setString(entries, key, value);
      changed = true;
    }
  }

  return changed;
};

export const listShortcuts = (root: KvEntry[]) => {
  const shortcuts = findEntry(root, "shortcuts");
  if (!shortcuts || shortcuts.value.type !== "map") return [];

  return shortcuts.value.entries.flatMap((entry) => {
    if (entry.value.type !== "map") return [];
    const appId = getEntryInt(entry.value.entries, "appid");
    if (appId === undefined) return [];

    return [
      {
        appId,
        appName: getEntryString(entry.value.entries, "AppName") ?? "",
        executablePath: unquote(
          getEntryString(entry.value.entries, "Exe") ?? ""
        ),
      },
    ];
  });
};

// ---------------------------------------------------------------------------
// Text KeyValues (config.vdf) — edited in place so nothing else is reformatted
// ---------------------------------------------------------------------------

interface Token {
  kind: "string" | "open" | "close";
  start: number;
  end: number;
  value: string;
}

const tokenize = (content: string): Token[] => {
  const tokens: Token[] = [];
  let index = 0;

  while (index < content.length) {
    const character = content[index];

    if (/\s/.test(character)) {
      index += 1;
    } else if (character === "/" && content[index + 1] === "/") {
      while (index < content.length && content[index] !== "\n") index += 1;
    } else if (character === "{" || character === "}") {
      tokens.push({
        kind: character === "{" ? "open" : "close",
        start: index,
        end: index + 1,
        value: character,
      });
      index += 1;
    } else if (character === '"') {
      const start = index;
      let value = "";
      index += 1;
      let closed = false;

      while (index < content.length) {
        const current = content[index];
        index += 1;
        if (current === '"') {
          closed = true;
          break;
        }
        if (current === "\\" && index < content.length) {
          value += content[index];
          index += 1;
        } else {
          value += current;
        }
      }

      if (!closed) throw new Error("Unterminated string in config.vdf");
      tokens.push({ kind: "string", start, end: index, value });
    } else {
      throw new Error(`Unexpected character "${character}" in config.vdf`);
    }
  }

  return tokens;
};

const matchingClose = (tokens: Token[], openIndex: number): number => {
  let depth = 0;

  for (let index = openIndex; index < tokens.length; index++) {
    if (tokens[index].kind === "open") depth += 1;
    if (tokens[index].kind === "close") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  throw new Error("Unbalanced braces in config.vdf");
};

interface Block {
  keyIndex: number;
  openIndex: number;
  closeIndex: number;
}

/** Finds a direct child block `key { ... }` between two token indexes. */
const findChildBlock = (
  tokens: Token[],
  from: number,
  to: number,
  key: string
): Block | null => {
  let index = from;

  while (index < to) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (token.kind === "string" && next?.kind === "open") {
      const closeIndex = matchingClose(tokens, index + 1);
      if (token.value.toLowerCase() === key.toLowerCase()) {
        return { keyIndex: index, openIndex: index + 1, closeIndex };
      }
      index = closeIndex + 1;
    } else if (token.kind === "string" && next?.kind === "string") {
      index += 2;
    } else {
      index += 1;
    }
  }

  return null;
};

const STEAM_BLOCK_PATH = ["InstallConfigStore", "Software", "Valve", "Steam"];

const findSteamBlock = (tokens: Token[]): Block | null => {
  let from = 0;
  let to = tokens.length;
  let block: Block | null = null;

  for (const key of STEAM_BLOCK_PATH) {
    block = findChildBlock(tokens, from, to, key);
    if (!block) return null;
    from = block.openIndex + 1;
    to = block.closeIndex;
  }

  return block;
};

const lineIndent = (content: string, position: number) => {
  const lineStart = content.lastIndexOf("\n", position - 1) + 1;
  return /^[ \t]*/.exec(content.slice(lineStart, position))?.[0] ?? "";
};

const lineStartOf = (content: string, position: number) =>
  content.lastIndexOf("\n", position - 1) + 1;

const renderMapping = (
  indent: string,
  appId: number,
  toolName: string,
  priority: number
) =>
  [
    `${indent}"${appId}"`,
    `${indent}{`,
    `${indent}\t"name"\t\t"${toolName}"`,
    `${indent}\t"config"\t\t""`,
    `${indent}\t"priority"\t\t"${priority}"`,
    `${indent}}`,
    "",
  ].join("\n");

const getMappingBlocks = (content: string) => {
  const tokens = tokenize(content);
  const steam = findSteamBlock(tokens);
  if (!steam) return null;

  const mapping = findChildBlock(
    tokens,
    steam.openIndex + 1,
    steam.closeIndex,
    "CompatToolMapping"
  );

  return { tokens, steam, mapping };
};

export const getCompatToolMapping = (
  content: string,
  appId: number
): string | null => {
  const blocks = getMappingBlocks(content);
  if (!blocks?.mapping) return null;

  const { tokens, mapping } = blocks;
  const app = findChildBlock(
    tokens,
    mapping.openIndex + 1,
    mapping.closeIndex,
    String(appId)
  );
  if (!app) return null;

  for (let index = app.openIndex + 1; index < app.closeIndex - 1; index++) {
    if (
      tokens[index].kind === "string" &&
      tokens[index].value.toLowerCase() === "name" &&
      tokens[index + 1].kind === "string"
    ) {
      return tokens[index + 1].value;
    }
  }

  return null;
};

/**
 * Sets `CompatToolMapping/<appId>` to the given tool. Returns the new file
 * content, or `null` when config.vdf does not have the expected
 * InstallConfigStore/Software/Valve/Steam structure (callers must not write).
 */
export const upsertCompatToolMapping = (
  content: string,
  appId: number,
  toolName: string = NOTPROTON_TOOL_NAME,
  priority: number = COMPAT_MAPPING_APP_PRIORITY
): string | null => {
  const blocks = getMappingBlocks(content);
  if (!blocks) return null;

  const { tokens, steam, mapping } = blocks;

  if (getCompatToolMapping(content, appId) === toolName) return content;

  const insertBeforeClose = (closeToken: Token, text: string) => {
    const closeLineStart = lineStartOf(content, closeToken.start);
    const onOwnLine =
      content.slice(closeLineStart, closeToken.start).trim() === "";
    const at = onOwnLine ? closeLineStart : closeToken.start;
    const prefix = onOwnLine ? "" : "\n";
    return content.slice(0, at) + prefix + text + content.slice(at);
  };

  if (!mapping) {
    const steamIndent = lineIndent(content, tokens[steam.keyIndex].start);
    const childIndent = `${steamIndent}\t`;
    const text =
      `${childIndent}"CompatToolMapping"\n${childIndent}{\n` +
      renderMapping(`${childIndent}\t`, appId, toolName, priority) +
      `${childIndent}}\n`;

    return insertBeforeClose(tokens[steam.closeIndex], text);
  }

  const mappingIndent = lineIndent(content, tokens[mapping.keyIndex].start);
  const childIndent = `${mappingIndent}\t`;
  const existing = findChildBlock(
    tokens,
    mapping.openIndex + 1,
    mapping.closeIndex,
    String(appId)
  );

  if (existing) {
    const start = lineStartOf(content, tokens[existing.keyIndex].start);
    const endToken = tokens[existing.closeIndex];
    let end = endToken.end;
    if (content[end] === "\r") end += 1;
    if (content[end] === "\n") end += 1;

    return (
      content.slice(0, start) +
      renderMapping(childIndent, appId, toolName, priority) +
      content.slice(end)
    );
  }

  return insertBeforeClose(
    tokens[mapping.closeIndex],
    renderMapping(childIndent, appId, toolName, priority)
  );
};
