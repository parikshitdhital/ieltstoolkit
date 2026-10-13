// Vercel function: returns all students' activity to the teacher page. Env vars: TEACHER_KEY (your private password) + the Redis vars.
const crypto = require("crypto");
const RURL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, RTOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = async cmd => { const r = await fetch(RURL(), { method: "POST", headers: { Authorization: "Bearer " + RTOK(), "Content-Type": "application/json" }, body: JSON.stringify(cmd) }); if (!r.ok) throw new Error("redis " + r.status); return (await r.json()).result; };
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const kathmandu = ms => new Date(ms + 5.75 * 3600e3).toISOString().slice(0, 10);
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const key = process.env.TEACHER_KEY; if (!key || !RURL() || !RTOK()) return res.status(500).json({ error: "Server not configured" });
  const given = req.headers["x-teacher-key"] || "";
  if (!eq(given, key)) { await new Promise(r => setTimeout(r, 600)); return res.status(401).json({ error: "Wrong key" }); }
  try {
    const users = (await redis(["SMEMBERS", "users"])) || [], students = [];
    for (const u of users.slice(0, 100)) { const raw = await redis(["GET", "rec:" + u]); if (!raw) continue; const r = JSON.parse(raw); const days = {}; Object.keys(r.days).sort().slice(-14).forEach(k => days[k] = r.days[k]); students.push({ u, seen: r.seen, snap: r.snap, days }); }
    return res.status(200).json({ now: Date.now(), today: kathmandu(Date.now()), students });
  } catch (e) { return res.status(502).json({ error: "Store failed" }); }
};
