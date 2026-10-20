// Vercel function: stores a student's study activity (counts and minutes only, never answers).
// Accepts batches of records, so time spent OFFLINE can be synced later. Env vars: TRACK_SECRET + the Redis REST vars.
const crypto = require("crypto");
const RURL = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, RTOK = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = async cmd => { const r = await fetch(RURL(), { method: "POST", headers: { Authorization: "Bearer " + RTOK(), "Content-Type": "application/json" }, body: JSON.stringify(cmd) }); if (!r.ok) throw new Error("redis " + r.status); return (await r.json()).result; };
const verify = (t, secret) => { try { const [b, s] = String(t).split("."); const e = crypto.createHmac("sha256", secret).update(b).digest("base64url"); const x = Buffer.from(s || ""), y = Buffer.from(e); if (x.length !== y.length || !crypto.timingSafeEqual(x, y)) return null; const p = JSON.parse(Buffer.from(b, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; } };
const kathmandu = ms => new Date(ms + 5.75 * 3600e3).toISOString().slice(0, 10);
const n = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
// Active minutes are stored per day as ranges of minute-of-day (Nepal time), e.g. [[450,505],[530,610]]. "ml" = minutes synced later (offline).
const mergeR = (R, mins) => { const a = R.map(r => [r[0], r[1]]); mins.forEach(x => a.push([x, x])); a.sort((p, q) => p[0] - q[0]); const out = []; a.forEach(r => { const l = out[out.length - 1]; if (l && r[0] <= l[1] + 1) l[1] = Math.max(l[1], r[1]); else out.push([r[0], r[1]]); }); return out.slice(0, 300); };
const addMin = (rec, am, from, to, secs, late) => {
  const lo = Math.floor(from / 60000) - 1, hi = Math.floor(to / 60000) + 1;
  const ms = [...new Set(am.map(Number))].filter(m => Number.isFinite(m) && m >= lo && m <= hi).sort((x, y) => x - y).slice(0, Math.floor(secs / 5) + 1);   // each marked minute needs real active time
  const by = {}; ms.forEach(m => { const loc = m + 345, d = Math.floor(loc / 1440), k = new Date(d * 86400000).toISOString().slice(0, 10); (by[k] = by[k] || []).push(loc - d * 1440); });
  Object.keys(by).forEach(k => { const cur = rec.days[k] || (rec.days[k] = { opens: 0, secs: 0, qs: 0, rq: 0, correct: 0, es: 0, fast: 0 }); const key = late ? "ml" : "m"; cur[key] = mergeR(cur[key] || [], by[k]); });
};
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const secret = process.env.TRACK_SECRET; if (!secret || !RURL() || !RTOK()) return res.status(500).json({ error: "Server not configured" });
  let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
  const tok = verify(b.token, secret); if (!tok) return res.status(401).json({ error: "Bad token" });
  const u = tok.u, now = Date.now();
  let recs = Array.isArray(b.recs) ? b.recs : (b.d ? [{ rid: "o" + now.toString(36) + Math.random().toString(36).slice(2, 6), from: now - 60000, to: now, sid: b.sid, st: b.st, d: b.d }] : []);
  recs = recs.slice(0, 120).sort((x, y) => (Number(x && x.from) || 0) - (Number(y && y.from) || 0));
  try {
    const key = "rec:" + u, raw = await redis(["GET", key]); let rec = raw ? JSON.parse(raw) : null; const fresh = !rec;
    rec = rec || { days: {}, seen: 0, snap: {}, done: [], lastTo: 0 }; rec.done = rec.done || []; let accepted = 0;
    for (const r of recs) {
      if (!r) continue;
      const rid = String(r.rid || "").replace(/[^a-z0-9]/gi, "").slice(0, 30); if (!rid || rec.done.includes(rid)) continue;   // duplicates are ignored
      const d = r.d || {};
      const to = Math.min(Number(r.to) || now, now + 60000), from = Math.min(to, Math.max(Number(r.from) || to, now - 72 * 3600e3));
      const eff = Math.max(from, rec.lastTo || 0), span = Math.max(0, (to - eff) / 1000);   // real time not already counted: nothing can be counted twice or exceed the clock
      const secs = n(d.secs, Math.min(3600, Math.floor(span) + 5)), qcap = Math.min(300, Math.floor(span / 2) + 5);   // at most one answer per 2 seconds
      const qs = n(d.qs, qcap), rq = n(d.rq, Math.max(0, qcap - qs));
      const add = { opens: n(d.opens, 3), secs, qs, rq, correct: Math.min(qs, n(d.correct, 300)), es: n(d.es, 10), fast: Math.min(qs + rq, n(d.fast, 300)) };
      const day = kathmandu(to), cur = rec.days[day] || { opens: 0, secs: 0, qs: 0, rq: 0, correct: 0, es: 0, fast: 0 };
      Object.keys(add).forEach(k => { cur[k] = (cur[k] || 0) + add[k]; }); rec.days[day] = cur;
      const sid = String(r.sid || "").replace(/[^a-z0-9]/gi, "").slice(0, 20);
      if (sid) { cur.v = cur.v || []; let ss = cur.v.find(x => x.id === sid); if (!ss && cur.v.length < 60) { ss = { id: sid, s: Math.min(to, Math.max(now - 72 * 3600e3, Number(r.st) || from)), e: to, secs: 0, qs: 0 }; cur.v.push(ss); } if (ss) { ss.e = Math.max(ss.e, to); ss.secs += secs; ss.qs += qs + rq; if (now - to > 300000) ss.off = 1; } }   // off = synced later (was offline)
      if (Array.isArray(r.am)) addMin(rec, r.am.slice(0, 1500), from, to, secs, now - to > 300000);
      rec.lastTo = Math.max(rec.lastTo || 0, to); rec.done.push(rid); accepted++;
    }
    rec.done = rec.done.slice(-500);
    Object.keys(rec.days).sort().slice(0, -180).forEach(k => delete rec.days[k]);
    if (b.snap) { const s = b.snap; rec.snap = { xp: n(s.xp, 1e7), streak: n(s.streak, 9999), stars: n(s.stars, 999), words: n(s.words, 9999), miss: (Array.isArray(s.miss) ? s.miss.slice(0, 5) : []).map(m => [String(m[0]).slice(0, 40), n(m[1], 99999)]) }; }
    if (accepted) rec.seen = Math.min(now, rec.lastTo || now);
    await redis(["SET", key, JSON.stringify(rec)]); if (fresh) await redis(["SADD", "users", u]);
    return res.status(200).json({ ok: true, accepted, now });
  } catch (e) { return res.status(502).json({ error: "Store failed" }); }
};
