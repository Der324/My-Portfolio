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
app.set("trust proxy", 1);
 
// ════════════════════════════════════════
//  SECURITY FIX 4: Body size limit
//  Prevents oversized payload attacks.
//  Must be set BEFORE express.json()
// ════════════════════════════════════════
app.use(express.json({ limit: "10kb" }));
 
// ════════════════════════════════════════
//  CORS
//  Note: CORS only restricts browsers.
//  curl/Postman can still reach the API.
//  Server-side validation is the real guard.
// ════════════════════════════════════════
app.use(cors({
  origin: [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "https://der324.github.io",
    "https://my-portfolio-production-9dd4.up.railway.app",
  ],
  methods: ["GET", "POST"],
}));
 
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
//  SECURITY FIX 6: Tighter rate limiting
//  Reduced from 25 to 5 submit attempts
//  per 15 minutes per IP.
// ════════════════════════════════════════
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many submission attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
 
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
 
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
 
// ════════════════════════════════════════
//  DATABASE
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
//  WRITE QUEUE — prevents concurrent
//  write corruption on the JSON file
// ════════════════════════════════════════
let writeQueue = Promise.resolve();
 
function queueWrite(fn) {
  writeQueue = writeQueue.then(fn).catch(err => {
    console.error("Write queue error:", err);
    throw err;
  });
  return writeQueue;
}
 
// ════════════════════════════════════════
//  RESEND EMAIL
// ════════════════════════════════════════
let resend = null;
 
function initResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.error("RESEND_API_KEY missing."); return null; }
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
//  EMAIL BATCH — groups submissions within
//  60s window to avoid inbox flooding
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
      `   Email    : ${e.email}`,
      `   Phone    : ${e.phone}`,
      `   Match    : ${e.teamA} vs ${e.teamB}${league}`,
      ``,
      `   Half time : ${e.fhLeader} leads · ${e.fhGoals} goal${e.fhGoals !== 1 ? "s" : ""}`,
      `   Full time : ${e.shLeader} leads · ${e.shGoals} goal${e.shGoals !== 1 ? "s" : ""}`,
      `   Winner    : ${e.winner}`,
      ``,
      `   Submitted : ${new Date(e.submittedAt).toLocaleString("en-RW", {
        timeZone: "Africa/Kigali", dateStyle: "medium", timeStyle: "short"
      })}`,
    ].join("\n");
  }).join("\n\n" + "─".repeat(44) + "\n\n");
 
  const subject = count === 1
    ? `⚽ New Prediction — ${batch[0].entry.teamA} vs ${batch[0].entry.teamB}`
    : `⚽ ${count} New Predictions — Mundi Predict & Win`;
 
  sendEmail(
    "ntalenderick@gmail.com",
    subject,
    `${count} new prediction${count > 1 ? "s" : ""} received\n` +
    `${"═".repeat(44)}\n\n` + entries + `\n\n` +
    `${"═".repeat(44)}\n` +
    `View all entries in your admin panel.\n`
  );
}
 
// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
function getAllMatches() { return { ...db.data.matches }; }
 
const sanitize = (str) =>
  String(str || "").replace(/[<>"']/g, "").trim().slice(0, 100);
 
// ════════════════════════════════════════
//  MATCH DURATION: 90 MINUTES
//  A standard football match is 90 minutes.
//  Was incorrectly set to 120 minutes before.
// ════════════════════════════════════════
const MATCH_DURATION_MS = 90 * 60 * 1000;
 
function getMatchEnd(kickoff) {
  return new Date(new Date(kickoff).getTime() + MATCH_DURATION_MS);
}
 
// ════════════════════════════════════════
//  ADMIN SECRET VALIDATOR
//  Used by all admin endpoints
// ════════════════════════════════════════
function verifyAdmin(secret) {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    console.error("ADMIN_SECRET not set in environment variables.");
    return false;
  }
  return secret === adminSecret;
}
 
// ════════════════════════════════════════
//  GET /matches  (public)
//  Returns active + upcoming matches with
//  team names and league set by admin.
// ════════════════════════════════════════
app.get("/matches", statusLimiter, async (req, res) => {
  await db.read();
  const matches = getAllMatches();
  const now     = new Date();
  const pub     = {};
 
  for (const id in matches) {
    const kickoff  = new Date(matches[id].kickoff);
    const matchEnd = getMatchEnd(kickoff);
    // Show matches that haven't ended yet
    if (now < matchEnd) {
      pub[id] = {
        kickoff: matches[id].kickoff,
        label:   matches[id].label,
        teamA:   matches[id].teamA  || "",
        teamB:   matches[id].teamB  || "",
        league:  matches[id].league || "",
      };
    }
  }
 
  res.json(pub);
});
 
// ── GET /next-match ──
app.get("/next-match", statusLimiter, async (req, res) => {
  await db.read();
  const matches  = getAllMatches();
  const now      = new Date();
  const upcoming = [];
 
  for (const id in matches) {
    const kickoff = new Date(matches[id].kickoff);
    if (kickoff > now) upcoming.push({ id, kickoff, label: matches[id].label });
  }
 
  if (upcoming.length === 0) return res.json({ found: false });
  upcoming.sort((a, b) => a.kickoff - b.kickoff);
  const next = upcoming[0];
 
  res.json({
    found:   true,
    kickoff: next.kickoff.toISOString(),
    matchId: next.id,
    label:   next.label,
  });
});
 
// ── GET /status ──
app.get("/status", statusLimiter, async (req, res) => {
  const { matchId } = req.query;
  await db.read();
  const matches = getAllMatches();
 
  if (!matchId || !matches[matchId]) {
    return res.status(404).json({ error: "Match not found." });
  }
 
  const match    = matches[matchId];
  const now      = new Date();
  const kickoff  = new Date(match.kickoff);
  const matchEnd = getMatchEnd(kickoff);
  const open     = now < kickoff;   // predictions open ONLY before kickoff
  const ended    = now >= matchEnd; // match ended after 90 minutes
  const count    = (db.data.submissions[matchId] || []).length;
 
  res.json({
    open,
    ended,
    kickoff:  match.kickoff,
    matchEnd: matchEnd.toISOString(),
    total:    count,
  });
});
 
// ════════════════════════════════════════
//  POST /submit
//
//  SECURITY: One submission per email per match.
//  SECURITY: Closed after kickoff — server
//  checks its own clock, not the client's.
//  SECURITY: teamA and teamB come from the
//  server's own database, not user input.
//  SECURITY FIX 7: Goals validated 0-20.
// ════════════════════════════════════════
app.post("/submit", submitLimiter, requireBody, async (req, res) => {
  const now  = new Date();
  const data = req.body;
 
  await db.read();
  const matches = getAllMatches();
  const match   = matches[data.matchId];
 
  // Validate match exists
  if (!match) {
    return res.status(404).json({ error: "Invalid match." });
  }
 
  // SECURITY: Block submissions after kickoff — server enforces this
  if (now >= new Date(match.kickoff)) {
    return res.status(403).json({
      error: "Predictions are closed. The match has already started.",
    });
  }
 
  // Sanitize user inputs
  const clean = {
    name:     sanitize(data.name),
    email:    sanitize(data.email).toLowerCase(),
    phone:    sanitize(data.phone),
    // SECURITY FIX 5: Team names come from SERVER database only
    // User cannot inject their own team names
    teamA:    sanitize(match.teamA || ""),
    teamB:    sanitize(match.teamB || ""),
    fhLeader: sanitize(data.fhLeader),
    fhGoals:  parseInt(data.fhGoals, 10),
    shLeader: sanitize(data.shLeader),
    shGoals:  parseInt(data.shGoals, 10),
    winner:   sanitize(data.winner),
  };
 
  // Validate required text fields
  const requiredText = ["name", "email", "phone", "fhLeader", "shLeader", "winner"];
  for (const field of requiredText) {
    if (!clean[field]) {
      return res.status(400).json({ error: `Missing field: ${field}` });
    }
  }
 
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(clean.email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }
 
  // SECURITY FIX 7: Strict goal validation
  if (
    isNaN(clean.fhGoals) || isNaN(clean.shGoals) ||
    clean.fhGoals < 0   || clean.shGoals < 0     ||
    clean.fhGoals > 20  || clean.shGoals > 20
  ) {
    return res.status(400).json({ error: "Invalid goal values (must be 0–20)." });
  }
 
  // Validate prediction values are allowed options
  const validLeaders = [clean.teamA, clean.teamB, "Draw"].filter(Boolean);
  if (!validLeaders.includes(clean.fhLeader)) {
    return res.status(400).json({ error: "Invalid first half leader." });
  }
  if (!validLeaders.includes(clean.shLeader)) {
    return res.status(400).json({ error: "Invalid second half leader." });
  }
  if (![clean.teamA, clean.teamB, "Draw"].filter(Boolean).includes(clean.winner)) {
    return res.status(400).json({ error: "Invalid winner selection." });
  }
 
  let result = null;
 
  try {
    await queueWrite(async () => {
      await db.read();
      db.data.submissions[data.matchId] ||= [];
 
      // SECURITY: One submission per email address per match
      const alreadySubmitted = db.data.submissions[data.matchId]
        .some(e => e.email === clean.email);
 
      if (alreadySubmitted) {
        result = {
          code: 409,
          body: { error: "You have already submitted a prediction for this match." },
        };
        return;
      }
 
      const record = { ...clean, submittedAt: now.toISOString() };
      db.data.submissions[data.matchId].push(record);
      await db.write();
      result = { code: 200, body: { status: "success" }, record };
    });
  } catch (err) {
    console.error("Submit write failed:", err);
    return res.status(500).json({ error: "Server error. Please try again." });
  }
 
  if (!result || result.code !== 200) {
    return res.status(result ? result.code : 500)
              .json(result ? result.body : { error: "Unexpected error." });
  }
 
  res.json(result.body);
  queueEmail(result.record, data.matchId, match);
});
 
// ════════════════════════════════════════
//  POST /admin/match
//  Now stores teamA, teamB, league.
// ════════════════════════════════════════
app.post("/admin/match", adminLimiter, requireBody, async (req, res) => {
  const { secret, matchId, label, kickoff, teamA, teamB, league } = req.body;
 
  if (!verifyAdmin(secret)) {
    return res.status(403).json({ error: "Unauthorized." });
  }
 
  if (!matchId || !label || !kickoff) {
    return res.status(400).json({ error: "matchId, label, and kickoff are required." });
  }
 
  if (!teamA || !teamB) {
    return res.status(400).json({ error: "teamA and teamB are required." });
  }
 
  if (String(matchId).length > 80) {
    return res.status(400).json({ error: "matchId must be 80 characters or fewer." });
  }
 
  if (isNaN(new Date(kickoff).getTime())) {
    return res.status(400).json({ error: "Invalid kickoff date format." });
  }
 
  try {
    await queueWrite(async () => {
      await db.read();
      db.data.matches[sanitize(matchId)] = {
        label:   sanitize(label),
        kickoff: new Date(kickoff).toISOString(),
        teamA:   sanitize(teamA),
        teamB:   sanitize(teamB),
        league:  sanitize(league || ""),
      };
      await db.write();
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error saving match." });
  }
 
  res.json({ status: "Match added", matchId, label, teamA, teamB, league, kickoff });
});
 
// ════════════════════════════════════════
//  SECURITY FIX 3: Admin endpoints now use
//  POST with secret in body instead of GET
//  with secret in URL (which appears in logs).
//
//  GET /admin/matches — kept for admin panel
//  login check but uses query param minimally
// ════════════════════════════════════════
app.get("/admin/matches", adminLimiter, async (req, res) => {
  if (!verifyAdmin(req.query.secret)) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  await db.read();
  res.json(getAllMatches());
});
 
// ════════════════════════════════════════
//  POST /admin/submissions
//  SECURITY FIX 3: Moved to POST so secret
//  goes in request body, not URL/logs.
// ════════════════════════════════════════
app.post("/admin/submissions", adminLimiter, requireBody, async (req, res) => {
  if (!verifyAdmin(req.body.secret)) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  await db.read();
  res.json(db.data.submissions);
});
 
// Keep GET for backward compat with existing admin.html
app.get("/admin/submissions", adminLimiter, async (req, res) => {
  if (!verifyAdmin(req.query.secret)) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  await db.read();
  res.json(db.data.submissions);
});
 
// ── POST /admin/reset ──
app.post("/admin/reset", adminLimiter, requireBody, async (req, res) => {
  const { secret, matchId } = req.body;
 
  if (!verifyAdmin(secret)) {
    return res.status(403).json({ error: "Unauthorized." });
  }
 
  if (!matchId) {
    return res.status(400).json({ error: "matchId is required." });
  }
 
  try {
    await queueWrite(async () => {
      await db.read();
      db.data.submissions[matchId] = [];
      await db.write();
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error during reset." });
  }
 
  res.json({ status: "Reset complete", matchId });
});
 
// ── GET /admin/test-email ──
app.get("/admin/test-email", adminLimiter, async (req, res) => {
  if (!verifyAdmin(req.query.secret)) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  if (!resend) return res.status(500).json({ error: "Resend not initialised." });
 
  try {
    const { data, error } = await resend.emails.send({
      from:    "Mundi Predict & Win <onboarding@resend.dev>",
      to:      ["ntalenderick@gmail.com"],
      subject: "✅ Mundi Email Test — Working!",
      text:    "Test email from Mundi Predict & Win.\nTime: " + new Date().toUTCString(),
    });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ status: "✅ Email sent", messageId: data.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
 
// ── GRACEFUL SHUTDOWN ──
process.on("SIGTERM", () => {
  console.log("SIGTERM — flushing email batch...");
  flushBatch();
  setTimeout(() => process.exit(0), 2000);
});
 
process.on("uncaughtException",  err => console.error("Uncaught:", err));
process.on("unhandledRejection", err => console.error("Unhandled:", err));
 
// ── START ──
const PORT = process.env.PORT || 3000;
initDB().then(() => {
  resend = initResend();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});