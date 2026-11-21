import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const secret = process.env["SESSION_SECRET"];
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHash("sha256").update(`telegram-storage:${secret}`).digest();
}
export function seal(value: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc1:${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64")}`;
}
export function unseal(value: string) {
  if (!value.startsWith("enc1:")) return value; // existing user sessions remain readable
  const data = Buffer.from(value.slice(5), "base64");
  const decipher = createDecipheriv("aes-256-gcm", key(), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8");
}