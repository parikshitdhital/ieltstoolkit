// Vercel function: stores each student's full progress in the cloud (same free Redis database), so a new phone gets it back after login.
// Uses version numbers so two devices can never silently overwrite each other. Env vars: TRACK_SECRET + the Redis REST vars.
const crypto = require("crypto");
const RURL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, RTOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = async cmd => { const r = await fetch(RURL(), { method: "POST", headers: { Authorization: "Bearer " + RTOK(), "Content-Type": "application/json" }, body: JSON.stringify(cmd) }); if (!r.ok) throw new Error("redis " + r.status); return (await r.json()).result; };
const verify = (t, secret) => { try { const [b, s] = String(t).split("."); const e = crypto.createHmac("sha256", secret).update(b).digest("base64url"); const x = Buffer.from(s || ""), y = Buffer.from(e); if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null; const p = JSON.parse(Buffer.from(b, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; } };
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const secret = process.env.TRACK_SECRET; if (!secret || !RURL() || !RTOK()) return res.status(500).json({ error: "Server not configured" });
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
  const tok = verify(b.token, secret); if (!tok) return res.status(401).json({ error: "Bad token" });
  const key = "prog:" + tok.u;
  try {
    const raw = await redis(["GET", key]), cur = raw ? JSON.parse(raw) : null, v = cur ? cur.v : 0;
    if (b.op === "get") return res.status(200).json({ ok: true, v, data: cur ? cur.data : null, now: Date.now() });
    if (b.op === "del") { await redis(["DEL", key]); return res.status(200).json({ ok: true }); }
    if (b.op === "put") {
      if (!b.data || typeof b.data !== "object" || Array.isArray(b.data)) return res.status(400).json({ error: "Bad data" });
      const text = JSON.stringify(b.data); if (text.length > 400000) return res.status(413).json({ error: "Too large" });
      if (Number(b.base) !== v) return res.status(409).json({ error: "Version changed", v, data: cur ? cur.data : null });   // another device saved first: the app merges and retries
      await redis(["SET", key, JSON.stringify({ v: v + 1, ts: Date.now(), data: b.data })]);
      return res.status(200).json({ ok: true, v: v + 1, now: Date.now() });
    }
    return res.status(400).json({ error: "Unknown op" });
  } catch (e) { return res.status(502).json({ error: "Store failed" }); }
};
