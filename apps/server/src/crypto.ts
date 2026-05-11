import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

/**
 * Versioned key registry.
 *
 * Env conventions:
 *   APP_SECRET_KEY           — legacy single key. Treated as version 1.
 *   APP_SECRET_KEY_V1=...    — explicit v1 key (equivalent to APP_SECRET_KEY).
 *   APP_SECRET_KEY_V2=...    — additional versions used during rotation.
 *   APP_SECRET_KEY_CURRENT=2 — which version seal() uses for new rows.
 *                              Defaults to the highest available version.
 *
 * During rotation, keep BOTH V1 and V2 in env so old rows still decrypt.
 * After running `pnpm rotate-keys`, every row's key_version is the current,
 * and V1 can be dropped from env.
 */

function parseKey(name: string, b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(`${name} must be ${KEY_LEN} bytes base64-encoded; got ${key.length}`);
  }
  return key;
}

/** Lazy-built map of version → Buffer. Cached for the process lifetime. */
let cachedKeys: Map<number, Buffer> | null = null;
let cachedCurrent: number | null = null;

function buildRegistry(): { keys: Map<number, Buffer>; current: number } {
  if (cachedKeys && cachedCurrent !== null) {
    return { keys: cachedKeys, current: cachedCurrent };
  }
  const keys = new Map<number, Buffer>();

  // Gather APP_SECRET_KEY_V{N} env vars.
  for (const [name, value] of Object.entries(process.env)) {
    if (!value) continue;
    const m = /^APP_SECRET_KEY_V(\d+)$/.exec(name);
    if (!m) continue;
    const version = Number(m[1]);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`Invalid key env var ${name}: version must be a positive integer`);
    }
    keys.set(version, parseKey(name, value));
  }

  // Back-compat: legacy APP_SECRET_KEY = version 1 unless V1 is already set.
  const legacy = process.env.APP_SECRET_KEY;
  if (legacy && !keys.has(1)) {
    keys.set(1, parseKey("APP_SECRET_KEY", legacy));
  }

  if (keys.size === 0) {
    throw new Error(
      "No encryption keys configured. Set APP_SECRET_KEY or APP_SECRET_KEY_V1 (32 bytes base64).",
    );
  }

  // Decide the "current" version used for new writes.
  let current: number;
  const currentEnv = process.env.APP_SECRET_KEY_CURRENT;
  if (currentEnv) {
    current = Number(currentEnv);
    if (!Number.isInteger(current) || !keys.has(current)) {
      throw new Error(
        `APP_SECRET_KEY_CURRENT=${currentEnv} does not match any loaded key version (loaded: ${[...keys.keys()].sort((a, b) => a - b).join(",")})`,
      );
    }
  } else {
    current = Math.max(...keys.keys());
  }

  cachedKeys = keys;
  cachedCurrent = current;
  return { keys, current };
}

/** Reset the in-memory cache. Test-only — production code paths are process-lifetime cached. */
export function __resetKeyRegistryForTests() {
  cachedKeys = null;
  cachedCurrent = null;
}

/** Which key version would a fresh `seal()` use? */
export function currentKeyVersion(): number {
  return buildRegistry().current;
}

/** List of loaded key versions, sorted ascending. Useful for ops tooling. */
export function loadedKeyVersions(): number[] {
  return [...buildRegistry().keys.keys()].sort((a, b) => a - b);
}

function getKey(version: number): Buffer {
  const { keys } = buildRegistry();
  const k = keys.get(version);
  if (!k) {
    throw new Error(
      `No key loaded for version ${version}. Loaded versions: ${[...keys.keys()].sort((a, b) => a - b).join(",")}. ` +
        `If rotating, ensure APP_SECRET_KEY_V${version} is set while old rows still reference it.`,
    );
  }
  return k;
}

export type Sealed = { ct: Buffer; iv: Buffer; tag: Buffer; keyVersion: number };

/**
 * Encrypt a UTF-8 string with AES-256-GCM under the current key version.
 * Fresh random IV per call. No AAD — ciphertext lives in its row; row
 * structure isn't part of integrity.
 */
export function seal(plaintext: string): Sealed {
  const version = currentKeyVersion();
  const key = getKey(version);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct, iv, tag, keyVersion: version };
}

/**
 * Decrypt a sealed payload using the key for its stored version.
 * If keyVersion is unspecified (legacy rows predating this column), treats
 * the row as version 1.
 */
export function open(sealed: Omit<Sealed, "keyVersion"> & { keyVersion?: number }): string {
  const version = sealed.keyVersion ?? 1;
  const key = getKey(version);
  const decipher = crypto.createDecipheriv(ALGO, key, sealed.iv);
  decipher.setAuthTag(sealed.tag);
  const pt = Buffer.concat([decipher.update(sealed.ct), decipher.final()]);
  return pt.toString("utf8");
}
