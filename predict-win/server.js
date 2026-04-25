// ════════════════════════════════════════
//  FORCE IPv4 — Railway blocks IPv6 outbound
// ════════════════════════════════════════
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
 
require("dotenv").config();
 
const express      = require("express");
const cors         = require("cors");
const rateLimit    = require("express-rate-limit");
const { Resend }   = require("resend");
const { Low }      = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path         = require("path");
 
const app = express();
 
// ════════════════════════════════════════
//  TRUST PROXY — Railway load balancer
// ════════════════════════════════════════
app.set("trust proxy", 1);
 
// ════════════════════════════════════════
//  BODY SIZE LIMIT — must come before
//  express.json() to prevent large payloads
// ════════════════════════════════════════
app.use(express.json({ limit: "10kb" }));
 
// ════════════════════════════════════════
//  CORS — covers both GitHub Pages repos
//  and local dev. CORS only stops browsers;
//  server-side validation is the real guard.
// ════════════════════════════════════════
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // non-browser clients
    if (origin.startsWith("https://der324.github.io")) return cb(null, true);
    if (origin === "http://127.0.0.1:5500") return cb(null, true);
    if (origin === "http://localhost:5500")  return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "DELETE"],
}));
 
// ════════════════════════════════════════
//  SECURITY HEADERS
// ════════════════════════════════════════
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});
 
// ════════════════════════════════════════
//  BODY GUARD
// ════════════════════════════════════════
function requireBody(req, res, next) {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "Request body must be JSON." });
  }
  next();
}
 
// ════════════════════════════════════════
//  RATE LIMITING
//  submit: 5 per 15 min per IP
//  status: 120 per min (countdown polls)
//  admin:  30 per 15 min
// ════════════════════════════════════════
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5,
  message: { error: "Too many attempts. Please try again later." },
  standardHeaders: true, legacyHeaders: false,
});
 
const statusLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120,
  standardHeaders: true, legacyHeaders: false,
});
 
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 30,
  standardHeaders: true, legacyHeaders: false,
});
 
// ════════════════════════════════════════
//  DATABASE  (submissions.json)
//  NOTE: Railway filesystem is ephemeral —
//  data resets on redeploy. Emails are the
//  reliable backup of all predictions.
// ════════════════════════════════════════
const dbFile  = path.join(__dirname, "submissions.json");
const adapter = new JSONFile(dbFile);
const db      = new Low(adapter, { submissions: {}, matches: {} });
 
async function initDB() {
  await db.read();
  db.data             ||= {};
  db.data.submissions ||= {};
  db.data.matches     ||= {};
  await db.write();
  console.log("Database ready.");
}
 
// ════════════════════════════════════════
//  WRITE QUEUE — serialises all DB writes
//  to prevent concurrent file corruption
// ════════════════════════════════════════
let writeQueue = Promise.resolve();
 
function queueWrite(fn) {
  writeQueue = writeQueue
    .then(fn)
    .catch(err => { console.error("Write queue error:", err); throw err; });
  return writeQueue;
}
 
// ════════════════════════════════════════
//  RESEND EMAIL
//  Uses HTTPS port 443 — Railway never
//  blocks this. SMTP (25/465/587) is blocked.
//
//  Required Railway Variable:
//    RESEND_API_KEY = re_xxxxxxxxxxxx
// ════════════════════════════════════════
let resend = null;
 
function initResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.error("RESEND_API_KEY missing from Railway Variables."); return null; }
  console.log("Email config OK — Resend ready.");
  return new Resend(key);
}
 
async function sendEmail(to, subject, text) {
  if (!resend) { console.error("Email skipped — Resend not initialised."); return; }
  try {
    const { data, error } = await resend.emails.send({
      from:    "Mundi Predict & Win <onboarding@resend.dev>",
      to:      [to],
      subject,
      text,
    });
    if (error) console.error("Email FAILED:", error.message || JSON.stringify(error));
    else       console.log("Email sent OK:", data.id);
  } catch (err) {
    console.error("Email exception:", err.message);
  }
}
 
// ════════════════════════════════════════
//  EMAIL BATCH QUEUE
//  Groups submissions within 60s into one
//  email. Flushed on SIGTERM so nothing lost.
// ════════════════════════════════════════
let pendingBatch = [];
let batchTimer   = null;
 
function queueEmail(entry, matchId, matchData) {
  pendingBatch.push({ entry, matchId, matchData });
  if (!batchTimer) batchTimer = setTimeout(flushBatch, 60 * 1000);
}
 
function flushBatch() {
  if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
  if (pendingBatch.length === 0) return;
 
  const batch = pendingBatch.splice(0);
  const count = batch.length;
 
  const entries = batch.map((item, i) => {
    const e      = item.entry;
    const league = item.matchData?.league ? ` · ${item.matchData.league}` : "";
    return [
      `${i + 1}. ${e.name}`,
      `   Email     : ${e.email}`,
      `   Phone     : ${e.phone}`,
      `   Match     : ${e.teamA} vs ${e.teamB}${league}`,
      ``,
      `   Half time : ${e.fhLeader} leads · ${e.fhGoals} goal${e.fhGoals !== 1 ? "s" : ""}`,
      `   Full time : ${e.shLeader} leads · ${e.shGoals} goal${e.shGoals !== 1 ? "s" : ""}`,
      `   Winner    : ${e.winner}`,
      ``,
      `   Submitted : ${new Date(e.submittedAt).toLocaleString("en-RW", {
        timeZone: "Africa/Kigali", dateStyle: "medium", timeStyle: "short",
      })} (Kigali)`,
    ].join("\n");
  }).join("\n\n" + "─".repeat(46) + "\n\n");
 
  const subject = count === 1
    ? `⚽ New Prediction — ${batch[0].entry.teamA} vs ${batch[0].entry.teamB}`
    : `⚽ ${count} New Predictions — Mundi Predict & Win`;
 
  sendEmail(
    "ntalenderick@gmail.com",
    subject,
    `${count} new prediction${count > 1 ? "s" : ""} received\n` +
    `${"═".repeat(46)}\n\n` + entries + `\n\n` +
    `${"═".repeat(46)}\n` +
    `View all submissions in your admin panel.\n`
  );
}
 
// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
function getAllMatches() { return { ...db.data.matches }; }
 
const sanitize = (str) =>
  String(str || "").replace(/[<>"'`\\]/g, "").trim().slice(0, 100);
 
// Standard football match = 90 minutes
const MATCH_DURATION_MS = 90 * 60 * 1000;
 
function getMatchEnd(kickoff) {
  return new Date(new Date(kickoff).getTime() + MATCH_DURATION_MS);
}
 
function verifyAdmin(secret) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) { console.error("ADMIN_SECRET not set."); return false; }
  return typeof secret === "string" && secret === adminSecret;
}
 
// ════════════════════════════════════════
//  GET /matches  (public)
//  Returns non-ended matches with admin-set
//  team names and league for the frontend.
// ════════════════════════════════════════
app.get("/matches", statusLimiter, async (req, res) => {
  try {
    await db.read();
    const matches = getAllMatches();
    const now     = new Date();
    const pub     = {};
 
    for (const id in matches) {
      const kickoff  = new Date(matches[id].kickoff);
      const matchEnd = getMatchEnd(kickoff);
      if (now < matchEnd) {
        pub[id] = {
          kickoff: matches[id].kickoff,
          label:   matches[id].label  || "",
          teamA:   matches[id].teamA  || "",
          teamB:   matches[id].teamB  || "",
          league:  matches[id].league || "",
        };
      }
    }
 
    res.json(pub);
  } catch (err) {
    console.error("GET /matches:", err.message);
    res.status(500).json({ error: "Server error." });
  }
});
 
// ── GET /next-match ──
app.get("/next-match", statusLimiter, async (req, res) => {
  try {
    await db.read();
    const matches  = getAllMatches();
    const now      = new Date();
    const upcoming = [];
 
    for (const id in matches) {
      const kickoff = new Date(matches[id].kickoff);
      if (kickoff > now) upcoming.push({ id, kickoff, label: matches[id].label || "" });
    }
 
    if (upcoming.length === 0) return res.json({ found: false });
 
    upcoming.sort((a, b) => a.kickoff - b.kickoff);
    const next = upcoming[0];
    res.json({ found: true, kickoff: next.kickoff.toISOString(), matchId: next.id, label: next.label });
  } catch (err) {
    console.error("GET /next-match:", err.message);
    res.status(500).json({ error: "Server error." });
  }
});
 
// ── GET /status ──
app.get("/status", statusLimiter, async (req, res) => {
  try {
    const { matchId } = req.query;
    if (!matchId || typeof matchId !== "string" || matchId.length > 80) {
      return res.status(400).json({ error: "Invalid matchId." });
    }
 
    await db.read();
    const matches = getAllMatches();
 
    if (!matches[matchId]) {
      return res.status(404).json({ error: "Match not found." });
    }
 
    const match    = matches[matchId];
    const now      = new Date();
    const kickoff  = new Date(match.kickoff);
    const matchEnd = getMatchEnd(kickoff);
 
    res.json({
      open:     now < kickoff,
      ended:    now >= matchEnd,
      kickoff:  match.kickoff,
      matchEnd: matchEnd.toISOString(),
      total:    (db.data.submissions[matchId] || []).length,
    });
  } catch (err) {
    console.error("GET /status:", err.message);
    res.status(500).json({ error: "Server error." });
  }
});
 
// ════════════════════════════════════════
//  POST /submit
//
//  Strict one-prediction-per-match enforcement:
//  ✅ Server checks its own clock for kickoff
//  ✅ Server reads teamA/teamB from its own DB
//  ✅ Duplicate email check inside write queue
//  ✅ Prediction values validated against real
//     team names — no arbitrary strings
//  ✅ Goals 0–20 strictly enforced
//  ✅ Rate limited to 5 attempts per 15 min
// ════════════════════════════════════════
app.post("/submit", submitLimiter, requireBody, async (req, res) => {
  try {
    const now  = new Date();
    const data = req.body;
 
    if (!data.matchId || typeof data.matchId !== "string" || data.matchId.length > 80) {
      return res.status(400).json({ error: "Invalid matchId." });
    }
 
    await db.read();
    const matches = getAllMatches();
    const match   = matches[data.matchId];
 
    if (!match) return res.status(404).json({ error: "Match not found." });
 
    // ── STRICT: block after kickoff using SERVER clock ──
    if (now >= new Date(match.kickoff)) {
      return res.status(403).json({
        error: "Predictions are closed. This match has already started.",
      });
    }
 
    // Build clean record — team names ALWAYS from server DB, never user input
    const clean = {
      name:     sanitize(data.name),
      email:    sanitize(data.email || "").toLowerCase(),
      phone:    sanitize(data.phone),
      teamA:    sanitize(match.teamA || ""),
      teamB:    sanitize(match.teamB || ""),
      fhLeader: sanitize(data.fhLeader),
      fhGoals:  parseInt(data.fhGoals, 10),
      shLeader: sanitize(data.shLeader),
      shGoals:  parseInt(data.shGoals, 10),
      winner:   sanitize(data.winner),
    };
 
    // Required fields
    for (const field of ["name", "email", "phone", "fhLeader", "shLeader", "winner"]) {
      if (!clean[field]) return res.status(400).json({ error: `Missing field: ${field}` });
    }
 
    // Email format
    if (!/^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/.test(clean.email)) {
      return res.status(400).json({ error: "Invalid email address." });
    }
 
    // Phone: digits, spaces, +, dashes only
    if (!/^[\d\s+\-]{7,20}$/.test(clean.phone)) {
      return res.status(400).json({ error: "Invalid phone number." });
    }
 
    // Goals 0–20
    if (
      isNaN(clean.fhGoals) || isNaN(clean.shGoals) ||
      clean.fhGoals < 0 || clean.shGoals < 0 ||
      clean.fhGoals > 20 || clean.shGoals > 20
    ) {
      return res.status(400).json({ error: "Goal values must be 0–20." });
    }
 
    // Prediction values must match actual team names or Draw
    const valid = [clean.teamA, clean.teamB, "Draw"].filter(Boolean);
    if (!valid.includes(clean.fhLeader)) return res.status(400).json({ error: "Invalid first half selection." });
    if (!valid.includes(clean.shLeader)) return res.status(400).json({ error: "Invalid second half selection." });
    if (!valid.includes(clean.winner))   return res.status(400).json({ error: "Invalid winner selection." });
 
    let result = null;
 
    await queueWrite(async () => {
      await db.read();
      db.data.submissions[data.matchId] ||= [];
 
      // ── STRICT: one submission per email per match ──
      if (db.data.submissions[data.matchId].some(e => e.email === clean.email)) {
        result = { code: 409, body: { error: "You have already submitted a prediction for this match." } };
        return;
      }
 
      const record = { ...clean, submittedAt: now.toISOString() };
      db.data.submissions[data.matchId].push(record);
      await db.write();
      result = { code: 200, body: { status: "success" }, record };
    });
 
    if (!result || result.code !== 200) {
      return res.status(result?.code ?? 500).json(result?.body ?? { error: "Unexpected error." });
    }
 
    res.json(result.body);
    queueEmail(result.record, data.matchId, match);
 
  } catch (err) {
    console.error("POST /submit:", err.message);
    res.status(500).json({ error: "Server error. Please try again." });
  }
});
 
// ════════════════════════════════════════
//  POST /admin/match — schedule a match
// ════════════════════════════════════════
app.post("/admin/match", adminLimiter, requireBody, async (req, res) => {
  try {
    const { secret, matchId, label, kickoff, teamA, teamB, league } = req.body;
 
    if (!verifyAdmin(secret)) return res.status(403).json({ error: "Unauthorized." });
 
    if (!matchId || !label || !kickoff || !teamA || !teamB) {
      return res.status(400).json({ error: "matchId, label, kickoff, teamA, and teamB are all required." });
    }
 
    if (String(matchId).length > 80) return res.status(400).json({ error: "matchId too long." });
 
    const kickoffDate = new Date(kickoff);
    if (isNaN(kickoffDate.getTime())) return res.status(400).json({ error: "Invalid kickoff date." });
    if (kickoffDate <= new Date())    return res.status(400).json({ error: "Kickoff must be in the future." });
 
    await queueWrite(async () => {
      await db.read();
      db.data.matches[sanitize(matchId)] = {
        label:   sanitize(label),
        kickoff: kickoffDate.toISOString(),
        teamA:   sanitize(teamA),
        teamB:   sanitize(teamB),
        league:  sanitize(league || ""),
      };
      await db.write();
    });
 
    console.log(`Match added: ${sanitize(teamA)} vs ${sanitize(teamB)} [${matchId}]`);
    res.json({ status: "Match added", matchId, label, teamA, teamB, league, kickoff });
 
  } catch (err) {
    console.error("POST /admin/match:", err.message);
    res.status(500).json({ error: "Server error saving match." });
  }
});
 
// ════════════════════════════════════════
//  DELETE /admin/match — delete a match
//  AND all its submissions completely.
//  This causes the predict page to show
//  "No Active Match" immediately with no
//  countdown — exactly like a fresh state.
// ════════════════════════════════════════
app.delete("/admin/match", adminLimiter, requireBody, async (req, res) => {
  try {
    const { secret, matchId } = req.body;
 
    if (!verifyAdmin(secret)) return res.status(403).json({ error: "Unauthorized." });
 
    if (!matchId || typeof matchId !== "string") {
      return res.status(400).json({ error: "matchId is required." });
    }
 
    await queueWrite(async () => {
      await db.read();
 
      if (!db.data.matches[matchId]) {
        return; // already gone — not an error
      }
 
      // Remove match AND its submissions entirely
      delete db.data.matches[matchId];
      delete db.data.submissions[matchId];
      await db.write();
    });
 
    console.log(`Match deleted: ${matchId}`);
    res.json({ status: "Match deleted", matchId });
 
  } catch (err) {
    console.error("DELETE /admin/match:", err.message);
    res.status(500).json({ error: "Server error deleting match." });
  }
});
 
// ── GET /admin/matches ──
app.get("/admin/matches", adminLimiter, async (req, res) => {
  try {
    if (!verifyAdmin(req.query.secret)) return res.status(403).json({ error: "Unauthorized." });
    await db.read();
    res.json(getAllMatches());
  } catch (err) {
    console.error("GET /admin/matches:", err.message);
    res.status(500).json({ error: "Server error." });
  }
});
 
// ── GET /admin/submissions ──
app.get("/admin/submissions", adminLimiter, async (req, res) => {
  try {
    if (!verifyAdmin(req.query.secret)) return res.status(403).json({ error: "Unauthorized." });
    await db.read();
    res.json(db.data.submissions);
  } catch (err) {
    console.error("GET /admin/submissions:", err.message);
    res.status(500).json({ error: "Server error." });
  }
});
 
// ── POST /admin/reset — clears submissions only (match stays) ──
app.post("/admin/reset", adminLimiter, requireBody, async (req, res) => {
  try {
    const { secret, matchId } = req.body;
 
    if (!verifyAdmin(secret)) return res.status(403).json({ error: "Unauthorized." });
    if (!matchId) return res.status(400).json({ error: "matchId is required." });
 
    await queueWrite(async () => {
      await db.read();
      db.data.submissions[matchId] = [];
      await db.write();
    });
 
    console.log(`Submissions reset for: ${matchId}`);
    res.json({ status: "Reset complete", matchId });
 
  } catch (err) {
    console.error("POST /admin/reset:", err.message);
    res.status(500).json({ error: "Server error during reset." });
  }
});
 
// ── GET /admin/test-email ──
app.get("/admin/test-email", adminLimiter, async (req, res) => {
  try {
    if (!verifyAdmin(req.query.secret)) return res.status(403).json({ error: "Unauthorized." });
    if (!resend) return res.status(500).json({ error: "Resend not initialised. Check RESEND_API_KEY." });
 
    const { data, error } = await resend.emails.send({
      from:    "Mundi Predict & Win <onboarding@resend.dev>",
      to:      ["ntalenderick@gmail.com"],
      subject: "✅ Mundi Email Test — Working!",
      text:    "Test email from Mundi Predict & Win.\nTime: " + new Date().toUTCString(),
    });
 
    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: "✅ Email sent", to: "ntalenderick@gmail.com", id: data.id });
 
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ── 404 ──
app.use((_req, res) => res.status(404).json({ error: "Not found." }));
 
// ── Global error handler ──
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error." });
});
 
// ════════════════════════════════════════
//  GRACEFUL SHUTDOWN
// ════════════════════════════════════════
process.on("SIGTERM", () => {
  console.log("SIGTERM — flushing email batch...");
  flushBatch();
  setTimeout(() => process.exit(0), 2500);
});
 
process.on("uncaughtException",  err => console.error("Uncaught exception:", err));
process.on("unhandledRejection", err => console.error("Unhandled rejection:", err));
 
// ════════════════════════════════════════
//  START
// ════════════════════════════════════════
const PORT = process.env.PORT || 3000;
 
initDB().then(() => {
  resend = initResend();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});