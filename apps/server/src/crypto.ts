import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

function getKey(): Buffer {
  const b64 = process.env.APP_SECRET_KEY;
  if (!b64) throw new Error("APP_SECRET_KEY not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== KEY_LEN) {
    throw new Error(`APP_SECRET_KEY must be ${KEY_LEN} bytes base64-encoded; got ${key.length}`);
  }
  return key;
}

export type Sealed = { ct: Buffer; iv: Buffer; tag: Buffer };

/**
 * Encrypt a UTF-8 string with AES-256-GCM. Each call uses a fresh random IV.
 * No AAD — we store ciphertext alongside its row, so the row structure itself
 * isn't part of integrity. If we ever multi-purpose the key, add AAD.
 */
export function seal(plaintext: string): Sealed {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ct, iv, tag };
}

export function open(sealed: Sealed): string {
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGO, key, sealed.iv);
  decipher.setAuthTag(sealed.tag);
  const pt = Buffer.concat([decipher.update(sealed.ct), decipher.final()]);
  return pt.toString("utf8");
}
