// Vercel function: server-side student login. Returns a signed token the app uses for activity tracking.
// Env vars: APP_USERS (e.g. "student:123456,ravi:secret2"), TRACK_SECRET (any long random text).
const crypto = require("crypto");
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const sign = (p, secret) => { const b = Buffer.from(JSON.stringify(p)).toString("base64url"); return b + "." + crypto.createHmac("sha256", secret).update(b).digest("base64url"); };
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const secret = process.env.TRACK_SECRET, users = process.env.APP_USERS;
  if (!secret || !users) return res.status(500).json({ error: "Server not configured" });
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
  const u = String(b.u || "").trim().toLowerCase().slice(0, 40), p = String(b.p || "").slice(0, 100);
  let ok = false;
  users.split(",").forEach(pair => { const i = pair.indexOf(":"); if (i < 1) return; const name = pair.slice(0, i).trim().toLowerCase(), pw = pair.slice(i + 1).trim(); if (name === u && eq(pw, p)) ok = true; });
  if (!ok) { await new Promise(r => setTimeout(r, 600)); return res.status(401).json({ error: "Wrong username or password" }); }
  return res.status(200).json({ user: u, now: Date.now(), token: sign({ u, exp: Date.now() + 30 * 864e5 }, secret) });
};
