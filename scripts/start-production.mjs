import { existsSync } from "node:fs";
for (const file of ["backend/.env", "frontend/.env", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
for (const key of ["PORT", "HOST", "MONGO_URL", "DB_NAME", "ADMIN_PASSWORD", "SESSION_SECRET"]) if (!process.env[key]) throw new Error(`${key} is not set`);
if (process.env.ADMIN_PASSWORD.length < 16 || process.env.SESSION_SECRET.length < 32) throw new Error("Production requires a private ADMIN_PASSWORD of at least 16 characters and a SESSION_SECRET of at least 32 characters.");
await import("../.output/server/index.mjs");