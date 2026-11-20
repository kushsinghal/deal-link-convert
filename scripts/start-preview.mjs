import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
for (const file of ["backend/.env", "frontend/.env", ".env"]) {
  if (existsSync(root + file)) process.loadEnvFile(root + file);
}
for (const key of ["MONGO_URL", "DB_NAME", "ADMIN_PASSWORD", "SESSION_SECRET", "REACT_APP_BACKEND_URL", "PORT", "HOST"]) {
  if (!process.env[key]) throw new Error(`${key} is not set`);
}
const production = process.env.NODE_ENV === "production";
const child = spawn(process.execPath, production ? [root + "scripts/start-production.mjs"] : [root + "node_modules/vite/bin/vite.js", "--host", process.env.HOST, "--port", process.env.PORT], { cwd: root, env: process.env, stdio: "inherit" });
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
child.on("exit", code => process.exit(code ?? 1));