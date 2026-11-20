export function normalizeTelegram(input: string) {
  const raw = input.trim().replace(/^@/, "");
  let username = raw;
  if (raw.includes("/") || raw.includes(".")) {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!["t.me", "www.t.me", "telegram.me", "www.telegram.me"].includes(url.hostname)) throw new Error("Use a public Telegram channel URL or @username.");
    const parts = url.pathname.split("/").filter(Boolean);
    username = parts[parts[0] === "s" ? 1 : 0] || "";
  }
  if (!/^[a-zA-Z][\w]{3,31}$/.test(username)) throw new Error("Use a public channel username, not a private invite or group link.");
  return username;
}

export function normalizeSource(kind: string, input: string) {
  if (!["rss", "telegram", "web", "x"].includes(kind)) throw new Error("Choose Telegram, RSS feed, Website page or X account.");
  if (kind === "telegram") return normalizeTelegram(input);
  if (kind === "x") {
    const u = input.trim().replace(/^@/, "").replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, "").split(/[/?#]/)[0] || "";
    if (!/^[A-Za-z0-9_]{1,15}$/.test(u)) throw new Error("Enter an X username like @dealsindia");
    return u;
  }
  let url: URL;
  try { url = new URL(input.trim()); } catch { throw new Error("Enter a full https:// source URL."); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port || /^(localhost|.*\.local|.*\.internal|\[.*\]|\d+\.\d+\.\d+\.\d+)$/.test(url.hostname)) throw new Error("Use a public HTTP or HTTPS source URL without login credentials.");
  if (kind === "web" && !["desidime.com", "www.desidime.com", "dealsmagnet.com", "www.dealsmagnet.com"].includes(url.hostname)) throw new Error("Website reading supports DesiDime and DealsMagnet. For other sites, use an RSS feed or public Telegram channel.");
  url.hash = "";
  return url.href;
}