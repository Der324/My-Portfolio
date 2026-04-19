// ════════════════════════════════════════
//  FORCE IPv4 — must be the very first lines.
//  Railway cannot reach IPv6. family:4 in
//  createTransport is ignored by newer
//  nodemailer versions. This fixes DNS
//  globally before any connection is made.
// ════════════════════════════════════════
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
 
require("dotenv").config();
 
const express    = require("express");
const cors       = require("cors");
const rateLimit  = require("express-rate-limit");
const { Resend } = require("resend");
const { Low }    = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path       = require("path");
 
const app = express();
 
// ════════════════════════════════════════
//  TRUST PROXY
//  Railway sits behind a load balancer that
//  sets X-Forwarded-For. Without this, rate
//  limiting misidentifies every user as the
//  same IP and blocks them all together.
// ════════════════════════════════════════
app.set("trust proxy", 1);
 
// ════════════════════════════════════════
//  CORS
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
 
app.use(express.json());
 
// ════════════════════════════════════════
//  BODY GUARD MIDDLEWARE
//  express.json() silently sets req.body to
//  undefined when Content-Type is wrong.
//  This catches it before sanitize() crashes.
// ════════════════════════════════════════
function requireBody(req, res, next) {
  if (!req.body || typeof req.body !== "object") {
    return res.status(400).json({ error: "Request body must be JSON." });
  }
  next();
}
 
// ════════════════════════════════════════
//  RATE LIMITING
// ════════════════════════════════════════
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  message: { error: "Too many submissions from this network. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
 
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
 
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
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
  db.data ||= { submissions: {}, matches: {} };
  db.data.submissions ||= {};
  db.data.matches     ||= {};
  await db.write();
  console.log("Database ready.");
}
 
// ════════════════════════════════════════
//  WRITE QUEUE
//  Prevents concurrent write corruption.
//  Errors are re-thrown so the calling route
//  returns a 500 rather than silently crashing.
// ════════════════════════════════════════
let writeQueue = Promise.resolve();
 
function queueWrite(fn) {
  writeQueue = writeQueue
    .then(fn)
    .catch(err => {
      console.error("Write queue error:", err);
      throw err;
    });
  return writeQueue;
}
 
// ════════════════════════════════════════
//  EMAIL — RESEND API (HTTP, not SMTP)
//  Railway blocks all SMTP ports (25/465/587).
//  Resend uses HTTPS (port 443) which Railway
//  never blocks. Free tier: 3,000 emails/month.
//  Setup: resend.com → API Keys → add RESEND_API_KEY
//  to Railway Variables.
// ════════════════════════════════════════
const resend = new Resend(process.env.RESEND_API_KEY);
 
// Verify Resend key on startup
if (!process.env.RESEND_API_KEY) {
  console.error("EMAIL CONFIG: RESEND_API_KEY is not set in Railway Variables.");
  console.error("Go to resend.com → API Keys → create key → add to Railway Variables.");
} else {
  console.log("Email config OK — Resend API key found.");
}
 
async function sendEmailAsync(mailOptions) {
  try {
    const { data, error } = await resend.emails.send({
      from:    "Mundi Predict & Win <onboarding@resend.dev>",
      to:      process.env.GMAIL_USER,
      subject: mailOptions.subject,
      text:    mailOptions.text,
    });
    if (error) {
      console.error("Email send FAILED:", error.message);
    } else {
      console.log("Email sent OK:", data.id);
    }
  } catch (err) {
    console.error("Email send FAILED:", err.message);
  }
}
 
// ════════════════════════════════════════
//  BATCHED EMAIL QUEUE
//  One summary email per 60-second window.
//  On SIGTERM, the batch is flushed
//  immediately so no submissions are lost.
//
//  Each email you receive contains:
//    • Participant name, email, phone
//    • Both team names they entered
//    • Half-time and full-time predictions
//    • Winner prediction
//    • Submission timestamp
//  You pick the winner from this information.
// ════════════════════════════════════════
let pendingEmailBatch = [];
let emailFlushTimer   = null;
 
function queueSubmissionEmail(entry, matchId) {
  pendingEmailBatch.push({ entry, matchId });
  if (!emailFlushTimer) {
    emailFlushTimer = setTimeout(flushEmailBatch, 60 * 1000);
  }
}
 
function flushEmailBatch() {
  if (emailFlushTimer) {
    clearTimeout(emailFlushTimer);
    emailFlushTimer = null;
  }
  if (pendingEmailBatch.length === 0) return;
 
  const batch = pendingEmailBatch.splice(0);
  const count = batch.length;
 
  const lines = batch.map((item, i) => {
    const e = item.entry;
    return [
      `── ${i + 1}. ${e.name}  (Match: ${item.matchId}) ──`,
      `Email     : ${e.email}`,
      `Phone     : ${e.phone}`,
      `Match     : ${e.teamA} vs ${e.teamB}`,
      `Half-time : ${e.fhLeader} leads  |  Goals: ${e.fhGoals}`,
      `Full-time : ${e.shLeader} leads  |  Goals: ${e.shGoals}`,
      `Winner    : ${e.winner}`,
      `Submitted : ${new Date(e.submittedAt).toLocaleString("en-RW", { timeZone: "Africa/Kigali" })} (Kigali)`,
    ].join("\n");
  }).join("\n\n");
 
  sendEmailAsync({
    from:    process.env.GMAIL_USER,
    to:      "ntalenderick@gmail.com",
    subject: `⚽ ${count} New Prediction${count > 1 ? "s" : ""} — Mundi Predict & Win`,
    text:
      `${count} new submission${count > 1 ? "s" : ""} received:\n\n` +
      `${lines}\n\n` +
      `────────────────────────────────────\n` +
      `View all submissions + reset in admin.html\n`,
  });
}
 
// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
 
// Call db.read() before using this
function getAllMatches() {
  return { ...db.data.matches };
}
 
const sanitize = (str) =>
  String(str || "")
    .replace(/[<>"']/g, "")
    .trim()
    .slice(0, 100);
 
function getMatchEnd(kickoff) {
  return new Date(new Date(kickoff).getTime() + 2 * 60 * 60 * 1000);
}
 
// ════════════════════════════════════════
//  GET /matches  (public)
// ════════════════════════════════════════
app.get("/matches", statusLimiter, async (req, res) => {
  await db.read();
  const matches = getAllMatches();
  const now = new Date();
 
  const publicMatches = {};
  for (const id in matches) {
    const kickoff  = new Date(matches[id].kickoff);
    const matchEnd = getMatchEnd(kickoff);
    if (now < matchEnd) {
      publicMatches[id] = { kickoff: matches[id].kickoff };
    }
  }
 
  res.json(publicMatches);
});
 
// ════════════════════════════════════════
//  GET /next-match  (public)
// ════════════════════════════════════════
app.get("/next-match", statusLimiter, async (req, res) => {
  await db.read();
  const matches = getAllMatches();
  const now = new Date();
 
  const upcoming = [];
  for (const id in matches) {
    const kickoff = new Date(matches[id].kickoff);
    if (kickoff > now) upcoming.push({ id, kickoff });
  }
 
  if (upcoming.length === 0) return res.json({ found: false });
 
  upcoming.sort((a, b) => a.kickoff - b.kickoff);
  const next = upcoming[0];
 
  res.json({
    found:   true,
    kickoff: next.kickoff.toISOString(),
    matchId: next.id,
  });
});
 
// ════════════════════════════════════════
//  GET /status?matchId=...
// ════════════════════════════════════════
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
  const open     = now < kickoff;
  const ended    = now >= matchEnd;
  const count    = (db.data.submissions[matchId] || []).length;
 
  res.json({ open, ended, kickoff: match.kickoff, matchEnd: matchEnd.toISOString(), total: count });
});
 
// ════════════════════════════════════════
//  POST /submit
// ════════════════════════════════════════
app.post("/submit", submitLimiter, requireBody, async (req, res) => {
  const now  = new Date();
  const data = req.body;
 
  // FIX: fresh db.read() here so we never validate against stale match data
  await db.read();
  const matches = getAllMatches();
  const match   = matches[data.matchId];
 
  if (!match) {
    return res.status(404).json({ error: "Invalid match." });
  }
 
  if (now >= new Date(match.kickoff)) {
    return res.status(403).json({ error: "Predictions are closed. The match has started." });
  }
 
  const clean = {
    name:     sanitize(data.name),
    email:    sanitize(data.email).toLowerCase(),
    phone:    sanitize(data.phone),
    teamA:    sanitize(data.teamA),
    teamB:    sanitize(data.teamB),
    fhLeader: sanitize(data.fhLeader),
    fhGoals:  parseInt(data.fhGoals),
    shLeader: sanitize(data.shLeader),
    shGoals:  parseInt(data.shGoals),
    winner:   sanitize(data.winner),
  };
 
  const requiredText = ["name", "email", "phone", "teamA", "teamB", "fhLeader", "shLeader", "winner"];
  for (const field of requiredText) {
    if (!clean[field]) return res.status(400).json({ error: `Missing field: ${field}` });
  }
 
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(clean.email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }
 
  if (
    isNaN(clean.fhGoals) || isNaN(clean.shGoals) ||
    clean.fhGoals < 0   || clean.shGoals < 0     ||
    clean.fhGoals > 20  || clean.shGoals > 20
  ) {
    return res.status(400).json({ error: "Invalid goal values (must be 0–20)." });
  }
 
  let result = null;
 
  try {
    await queueWrite(async () => {
      await db.read();
      db.data.submissions[data.matchId] ||= [];
 
      const alreadySubmitted = db.data.submissions[data.matchId]
        .some(entry => entry.email === clean.email);
 
      if (alreadySubmitted) {
        result = { code: 409, body: { error: "You have already submitted a prediction for this match." } };
        return;
      }
 
      const record = { ...clean, submittedAt: now.toISOString() };
      db.data.submissions[data.matchId].push(record);
      await db.write();
      result = { code: 200, body: { status: "success" }, record };
    });
  } catch (err) {
    console.error("Submit write failed:", err);
    return res.status(500).json({ error: "Server error saving your prediction. Please try again." });
  }
 
  if (!result || result.code !== 200) {
    return res.status(result ? result.code : 500).json(
      result ? result.body : { error: "Unexpected server error." }
    );
  }
 
  res.json(result.body);
  queueSubmissionEmail(result.record, data.matchId);
});
 
// ════════════════════════════════════════
//  POST /admin/match
// ════════════════════════════════════════
app.post("/admin/match", adminLimiter, requireBody, async (req, res) => {
  const { secret, matchId, label, kickoff } = req.body;
 
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }
 
  if (!matchId || !label || !kickoff) {
    return res.status(400).json({ error: "matchId, label, and kickoff are all required." });
  }
 
  // FIX: explicit length check before sanitize silently truncates matchId
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
      };
      await db.write();
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error saving match. Please try again." });
  }
 
  res.json({ status: "Match added", matchId, label, kickoff });
});
 
// ════════════════════════════════════════
//  GET /admin/matches
// ════════════════════════════════════════
app.get("/admin/matches", adminLimiter, async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  await db.read();
  res.json(getAllMatches());
});
 
// ════════════════════════════════════════
//  GET /admin/submissions
// ════════════════════════════════════════
app.get("/admin/submissions", adminLimiter, async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  await db.read();
  res.json(db.data.submissions);
});
 
// ════════════════════════════════════════
//  POST /admin/reset
// ════════════════════════════════════════
app.post("/admin/reset", adminLimiter, requireBody, async (req, res) => {
  const { secret, matchId } = req.body;
 
  if (!secret || secret !== process.env.ADMIN_SECRET) {
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
    return res.status(500).json({ error: "Server error during reset. Please try again." });
  }
 
  res.json({ status: "Reset complete", matchId });
});
 
// ════════════════════════════════════════
//  GET /admin/test-email
//  Sends a real test email to ntalenderick@gmail.com
//  so you can confirm Gmail credentials work.
//
//  Usage — paste this in your browser
//  (replace YOUR_ADMIN_SECRET with your ADMIN_SECRET
//  from Railway Variables, NOT the Gmail password):
//
//  https://my-portfolio-production-9dd4.up.railway.app
//    /admin/test-email?secret=YOUR_ADMIN_SECRET
// ════════════════════════════════════════
app.get("/admin/test-email", adminLimiter, async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({
      error: "Unauthorized.",
      hint:  "?secret= must be your ADMIN_SECRET from Railway Variables, not the Gmail password.",
    });
  }
 
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = (process.env.GMAIL_PASSWORD || "").replace(/\s/g, "");
 
  if (!gmailUser || !gmailPass) {
    return res.status(500).json({
      error: "GMAIL_USER or GMAIL_PASSWORD is missing from Railway Variables.",
    });
  }
 
  try {
    const info = await transporter.sendMail({
      from:    gmailUser,
      to:      "ntalenderick@gmail.com",
      subject: "Mundi Predict & Win — Email Test",
      text:
        "This is a test email from your Mundi Predict & Win server.\n\n" +
        "If you received this, your Gmail credentials are working correctly.\n\n" +
        "Sent from: " + gmailUser + "\n" +
        "Time: " + new Date().toUTCString(),
    });
 
    console.log("Test email sent OK:", info.messageId);
    res.json({
      status:    "Email sent successfully",
      to:        "ntalenderick@gmail.com",
      messageId: info.messageId,
      note:      "Check your inbox and spam folder.",
    });
 
  } catch (err) {
    console.error("Test email failed:", err.message, "| code:", err.code);
    res.status(500).json({
      error:  "Email send failed: " + err.message,
      code:   err.code,
      fix:    err.code === "EAUTH"
        ? "Wrong Gmail credentials. Make sure GMAIL_PASSWORD in Railway has no spaces."
        : "Check Railway logs for more detail.",
    });
  }
});
 
// ════════════════════════════════════════
//  GRACEFUL SHUTDOWN
//  Flush pending email batch before Railway
//  restarts the server so nothing is lost.
// ════════════════════════════════════════
process.on("SIGTERM", () => {
  console.log("SIGTERM — flushing email batch...");
  flushEmailBatch();
  setTimeout(() => process.exit(0), 2000);
});
 
// ════════════════════════════════════════
//  GLOBAL ERROR HANDLERS
// ════════════════════════════════════════
process.on("uncaughtException",  (err) => console.error("Uncaught exception:", err));
process.on("unhandledRejection", (err) => console.error("Unhandled rejection:", err));
 
// ════════════════════════════════════════
//  START
// ════════════════════════════════════════
const PORT = process.env.PORT || 3000;
 
initDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});