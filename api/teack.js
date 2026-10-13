// Vercel function: stores a student's study activity (counts and minutes only, never answers).
// Env vars: TRACK_SECRET, and the Redis REST vars added by Vercel's Upstash integration
// (KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).
const crypto = require("crypto");
const RURL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, RTOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = async cmd => { const r = await fetch(RURL(), { method: "POST", headers: { Authorization: "Bearer " + RTOK(), "Content-Type": "application/json" }, body: JSON.stringify(cmd) }); if (!r.ok) throw new Error("redis " + r.status); return (await r.json()).result; };
const verify = (t, secret) => { try { const [b, s] = String(t).split("."); const e = crypto.createHmac("sha256", secret).update(b).digest("base64url"); const x = Buffer.from(s || ""), y = Buffer.from(e); if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null; const p = JSON.parse(Buffer.from(b, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; } };
const kathmandu = ms => new Date(ms + 5.75 * 3600e3).toISOString().slice(0, 10);
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const secret = process.env.TRACK_SECRET; if (!secret || !RURL() || !RTOK()) return res.status(500).json({ error: "Server not configured" });
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
  const tok = verify(b.token, secret); if (!tok) return res.status(401).json({ error: "Bad token" });
  const u = tok.u, now = Date.now(), n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0))), d = b.d || {};
  try {
    const key = "rec:" + u, raw = await redis(["GET", key]); let rec = raw ? JSON.parse(raw) : null; const fresh = !rec; rec = rec || { days: {}, seen: 0, snap: {} };
    const elapsed = rec.seen ? Math.min(600, (now - rec.seen) / 1000) : 60;  // wall-clock guard: active time can never exceed real elapsed time
    rec.credit = Math.min(180, (rec.credit == null ? 15 : rec.credit) + elapsed);
    const secs = n(d.secs, Math.min(120, Math.floor(rec.credit))); rec.credit -= secs;
    rec.qc = Math.min(80, (rec.qc == null ? 10 : rec.qc) + elapsed * 0.5);  // same guard for questions: at most one answer per 2 seconds of real time
    const qs = n(d.qs, Math.min(60, Math.floor(rec.qc))); rec.qc -= qs; const rq = n(d.rq, Math.min(60, Math.floor(rec.qc))); rec.qc -= rq;
    const add = { opens: n(d.opens, 3), secs, qs, rq, correct: Math.min(qs, n(d.correct, 60)), es: n(d.es, 5), fast: Math.min(qs + rq, n(d.fast, 60)) };
    const day = kathmandu(now), cur = rec.days[day] || { opens: 0, secs: 0, qs: 0, rq: 0, correct: 0, es: 0, fast: 0 };
    Object.keys(add).forEach(k => { cur[k] = (cur[k] || 0) + add[k]; }); rec.days[day] = cur;
    Object.keys(rec.days).sort().slice(0, -60).forEach(k => delete rec.days[k]);
    const s = b.snap || {}; rec.snap = { xp: n(s.xp, 1e7), streak: n(s.streak, 9999), stars: n(s.stars, 999), words: n(s.words, 9999), miss: (Array.isArray(s.miss) ? s.miss.slice(0, 5) : []).map(m => [String(m[0]).slice(0, 40), n(m[1], 99999)]) };
    rec.seen = now;
    await redis(["SET", key, JSON.stringify(rec)]); if (fresh) await redis(["SADD", "users", u]);
    return res.status(200).json({ ok: true });
  } catch (e) { return res.status(502).json({ error: "Store failed" }); }
};
