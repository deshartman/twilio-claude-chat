import { afterEach, beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  __resetKeyRegistryForTests,
  currentKeyVersion,
  loadedKeyVersions,
  open,
  seal,
} from "./crypto.js";

function randomKey(): string {
  return crypto.randomBytes(32).toString("base64");
}

const KEY_V1 = randomKey();
const KEY_V2 = randomKey();
const KEY_V3 = randomKey();

const originalEnv = { ...process.env };

beforeEach(() => {
  // Start each test with a clean, deterministic env slice. Clear anything
  // from the real .env that would poison the registry.
  for (const name of Object.keys(process.env)) {
    if (name === "APP_SECRET_KEY" || /^APP_SECRET_KEY_/.test(name)) {
      delete process.env[name];
    }
  }
  __resetKeyRegistryForTests();
});

afterEach(() => {
  process.env = { ...originalEnv };
  __resetKeyRegistryForTests();
});

describe("crypto keys registry", () => {
  it("accepts legacy APP_SECRET_KEY as version 1", () => {
    process.env.APP_SECRET_KEY = KEY_V1;
    expect(currentKeyVersion()).toBe(1);
    expect(loadedKeyVersions()).toEqual([1]);
  });

  it("V1 takes precedence over the legacy key when both are set", () => {
    // Intentional: an explicit V1 overrides the unsuffixed legacy var.
    process.env.APP_SECRET_KEY = KEY_V2; // different bytes from V1
    process.env.APP_SECRET_KEY_V1 = KEY_V1;
    __resetKeyRegistryForTests();
    const pt = "hello";
    const sealed = seal(pt);
    expect(sealed.keyVersion).toBe(1);
    // Rotating env to V1-only should still decrypt since V1 is the canonical key.
    delete process.env.APP_SECRET_KEY;
    __resetKeyRegistryForTests();
    expect(open(sealed)).toBe(pt);
  });

  it("picks the highest version when APP_SECRET_KEY_CURRENT is not set", () => {
    process.env.APP_SECRET_KEY_V1 = KEY_V1;
    process.env.APP_SECRET_KEY_V2 = KEY_V2;
    process.env.APP_SECRET_KEY_V3 = KEY_V3;
    expect(currentKeyVersion()).toBe(3);
    expect(loadedKeyVersions()).toEqual([1, 2, 3]);
  });

  it("honors APP_SECRET_KEY_CURRENT when set and valid", () => {
    process.env.APP_SECRET_KEY_V1 = KEY_V1;
    process.env.APP_SECRET_KEY_V2 = KEY_V2;
    process.env.APP_SECRET_KEY_CURRENT = "1";
    expect(currentKeyVersion()).toBe(1);
  });

  it("throws if APP_SECRET_KEY_CURRENT points at an unloaded version", () => {
    process.env.APP_SECRET_KEY_V1 = KEY_V1;
    process.env.APP_SECRET_KEY_CURRENT = "9";
    expect(() => currentKeyVersion()).toThrow(/does not match/);
  });

  it("throws if no keys are configured at all", () => {
    expect(() => currentKeyVersion()).toThrow(/No encryption keys configured/);
  });

  it("throws on malformed key length", () => {
    process.env.APP_SECRET_KEY_V1 = Buffer.alloc(16).toString("base64"); // wrong length
    expect(() => currentKeyVersion()).toThrow(/32 bytes/);
  });
});

describe("crypto seal/open", () => {
  it("round-trips under a single key", () => {
    process.env.APP_SECRET_KEY_V1 = KEY_V1;
    const pt = JSON.stringify({ sid: "SK123", secret: "topsecret" });
    const sealed = seal(pt);
    expect(sealed.keyVersion).toBe(1);
    expect(open(sealed)).toBe(pt);
  });

  it("decrypts an old-version row even when newer keys are current", () => {
    // This is THE rotation property — the Friday afternoon safety check.
    // Seal under V1, add V2 + make it current, confirm the V1 row still opens.
    process.env.APP_SECRET_KEY_V1 = KEY_V1;
    const sealedUnderV1 = seal("legacy-secret");
    expect(sealedUnderV1.keyVersion).toBe(1);

    // Rotate: add V2 and mark it current.
    process.env.APP_SECRET_KEY_V2 = KEY_V2;
    process.env.APP_SECRET_KEY_CURRENT = "2";
    __resetKeyRegistryForTests();

    expect(currentKeyVersion()).toBe(2);
    expect(open(sealedUnderV1)).toBe("legacy-secret");

    // A fresh seal should use V2.
    const sealedUnderV2 = seal("new-secret");
    expect(sealedUnderV2.keyVersion).toBe(2);
    expect(open(sealedUnderV2)).toBe("new-secret");
  });

  it("fails to decrypt if the row's key version is no longer loaded", () => {
    // Seal under V1, drop V1 from env. Decrypt should throw a helpful error.
    process.env.APP_SECRET_KEY_V1 = KEY_V1;
    const sealed = seal("x");
    delete process.env.APP_SECRET_KEY_V1;
    process.env.APP_SECRET_KEY_V2 = KEY_V2;
    __resetKeyRegistryForTests();
    expect(() => open(sealed)).toThrow(/No key loaded for version 1/);
  });

  it("treats a sealed blob with no explicit keyVersion as v1 (back-compat)", () => {
    process.env.APP_SECRET_KEY_V1 = KEY_V1;
    const sealed = seal("legacy-row");
    // Simulate a row read that never populated key_version — old DB state.
    const legacyShape = { ct: sealed.ct, iv: sealed.iv, tag: sealed.tag };
    expect(open(legacyShape)).toBe("legacy-row");
  });

  it("GCM detects tampering: wrong tag → throw", () => {
    process.env.APP_SECRET_KEY_V1 = KEY_V1;
    const sealed = seal("sensitive");
    const tamperedTag = Buffer.from(sealed.tag);
    tamperedTag[0] ^= 0xff;
    expect(() => open({ ...sealed, tag: tamperedTag })).toThrow();
  });
});
