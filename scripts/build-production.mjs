import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
for (const file of ["backend/.env", "frontend/.env", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
if (!process.env.REACT_APP_BACKEND_URL && process.env.RENDER_EXTERNAL_URL) process.env.REACT_APP_BACKEND_URL = process.env.RENDER_EXTERNAL_URL;
if (!process.env.REACT_APP_BACKEND_URL) throw new Error("REACT_APP_BACKEND_URL is required at build time");
const result = spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], { stdio: "inherit", env: { ...process.env, NITRO_PRESET: "node-server" } });
process.exit(result.status ?? 1);