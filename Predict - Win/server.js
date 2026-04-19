// ════════════════════════════════════════
//  FORCE IPv4 — must be the very first lines.
//  Railway cannot reach IPv6 reliably.
// ════════════════════════════════════════
const dns = require("dns");
dns.setDefaultResultOrder("ipv4first");
 
require("dotenv").config();
 
const express      = require("express");
const cors         = require("cors");
const rateLimit    = require("express-rate-limit");
const nodemailer   = require("nodemailer");
const { Low }      = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path         = require("path");
 
const app = express();
 
// ════════════════════════════════════════
//  TRUST PROXY
//  Railway sits behind a load balancer.
//  Without this, rate limiting misidentifies
//  every user as the same IP.
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
//  BODY GUARD
//  Catches missing/malformed JSON bodies
//  before they reach route handlers.
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
//  DATABASE  (submissions.json — in .gitignore)
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
//  WRITE QUEUE
//  Prevents concurrent write corruption.
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
//  EMAIL — NODEMAILER + GMAIL
//
//  FIX: Resend was used before but emails
//  were not arriving at ntalenderick@gmail.com
//  because onboarding@resend.dev can only
//  deliver to the Resend account owner's email.
//
//  Nodemailer + Gmail app password works
//  reliably and is already proven to work
//  in this project.
//
//  Required Railway Variables:
//    GMAIL_USER     = ntalenderick@gmail.com
//    GMAIL_PASSWORD = your 16-char app password (no spaces)
//
//  How to get/verify app password:
//    1. Go to myaccount.google.com/security
//    2. Enable 2-Step Verification if not already on
//    3. Search "App passwords"
//    4. Create one named "Mundi Railway"
//    5. Copy the 16 chars (remove spaces) into Railway Variables
// ════════════════════════════════════════
let transporter = null;
 
function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = (process.env.GMAIL_PASSWORD || "").replace(/\s/g, "");
 
  if (!user || !pass) {
    console.error("EMAIL CONFIG ERROR: GMAIL_USER or GMAIL_PASSWORD missing from Railway Variables.");
    return null;
  }
 
  return nodemailer.createTransport({
    host:   "smtp.gmail.com",
    port:   465,
    secure: true,          // SSL — avoids Railway blocking port 587
    auth:   { user, pass },
    tls: {
      rejectUnauthorized: true,
    },
  });
}
 
// ════════════════════════════════════════
//  SEND EMAIL (fire-and-forget)
//  Prediction is always saved first.
//  Email failure never blocks the response.
// ════════════════════════════════════════
async function sendEmail(to, subject, text) {
  if (!transporter) {
    console.error("Email skipped — transporter not initialised (check Railway Variables).");
    return;
  }
 
  try {
    const info = await transporter.sendMail({
      from:    `"Mundi Predict & Win" <${process.env.GMAIL_USER}>`,
      to,
      subject,
      text,
    });
    console.log("Email sent OK:", info.messageId);
  } catch (err) {
    console.error("Email FAILED:", err.message, "| code:", err.code);
  }
}
 
// ════════════════════════════════════════
//  EMAIL BATCH QUEUE
//  Groups submissions within a 60-second
//  window into one email so your inbox
//  doesn't get flooded during busy periods.
//  On SIGTERM the batch flushes immediately.
// ════════════════════════════════════════
let pendingBatch   = [];
let batchTimer     = null;
 
function queueEmail(entry, matchId) {
  pendingBatch.push({ entry, matchId });
  if (!batchTimer) {
    batchTimer = setTimeout(flushBatch, 60 * 1000);
  }
}
 
function flushBatch() {
  if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
  if (pendingBatch.length === 0) return;
 
  const batch = pendingBatch.splice(0);
  const count = batch.length;
 
  const lines = batch.map((item, i) => {
    const e = item.entry;
    return [
      `─────────────────────────────────────`,
      `  ${i + 1}. ${e.name}`,
      `─────────────────────────────────────`,
      `  Match ID  : ${item.matchId}`,
      `  Email     : ${e.email}`,
      `  Phone     : ${e.phone}`,
      ``,
      `  Match     : ${e.teamA}  vs  ${e.teamB}`,
      ``,
      `  ┌── FIRST HALF PREDICTION ──────────`,
      `  │  Leading at half time : ${e.fhLeader}`,
      `  │  Goals in first half  : ${e.fhGoals}`,
      `  └───────────────────────────────────`,
      ``,
      `  ┌── SECOND HALF PREDICTION ─────────`,
      `  │  Leading at full time  : ${e.shLeader}`,
      `  │  Goals in second half  : ${e.shGoals}`,
      `  └───────────────────────────────────`,
      ``,
      `  ┌── FINAL RESULT ────────────────────`,
      `  │  Match winner : ${e.winner}`,
      `  └───────────────────────────────────`,
      ``,
      `  Submitted : ${new Date(e.submittedAt).toLocaleString("en-RW", {
        timeZone: "Africa/Kigali"
      })} (Kigali time)`,
    ].join("\n");
  }).join("\n\n");
 
  sendEmail(
    "ntalenderick@gmail.com",
    `⚽ ${count} New Prediction${count > 1 ? "s" : ""} — Mundi Predict & Win`,
    `${count} new prediction${count > 1 ? "s" : ""} received:\n\n` +
    `${lines}\n\n` +
    `─────────────────────────────────────\n` +
    `View all submissions in your admin panel.\n`
  );
}
 
// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
function getAllMatches() {
  return { ...db.data.matches };
}
 
const sanitize = (str) =>
  String(str || "").replace(/[<>"']/g, "").trim().slice(0, 100);
 
function getMatchEnd(kickoff) {
  return new Date(new Date(kickoff).getTime() + 2 * 60 * 60 * 1000);
}
 
// ════════════════════════════════════════
//  GET /matches  (public — used by script.js)
// ════════════════════════════════════════
app.get("/matches", statusLimiter, async (req, res) => {
  await db.read();
  const matches = getAllMatches();
  const now     = new Date();
 
  const publicMatches = {};
  for (const id in matches) {
    const kickoff  = new Date(matches[id].kickoff);
    const matchEnd = getMatchEnd(kickoff);
    if (now < matchEnd) {
      publicMatches[id] = {
        kickoff: matches[id].kickoff,
        label:   matches[id].label,
      };
    }
  }
 
  res.json(publicMatches);
});
 
// ════════════════════════════════════════
//  GET /next-match  (public)
// ════════════════════════════════════════
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
// ════════════════════════════════════════
app.post("/submit", submitLimiter, requireBody, async (req, res) => {
  const now  = new Date();
  const data = req.body;
 
  await db.read();
  const matches = getAllMatches();
  const match   = matches[data.matchId];
 
  if (!match) {
    return res.status(404).json({ error: "Invalid match." });
  }
 
  if (now >= new Date(match.kickoff)) {
    return res.status(403).json({
      error: "Predictions are closed. The match has started.",
    });
  }
 
  // Sanitize
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
 
  // Validate required text fields
  const requiredText = [
    "name", "email", "phone", "teamA", "teamB",
    "fhLeader", "shLeader", "winner",
  ];
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
 
  // Validate goals
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
    return res.status(500).json({
      error: "Server error saving your prediction. Please try again.",
    });
  }
 
  if (!result || result.code !== 200) {
    return res
      .status(result ? result.code : 500)
      .json(result ? result.body : { error: "Unexpected server error." });
  }
 
  // Respond immediately — email is fire-and-forget
  res.json(result.body);
  queueEmail(result.record, data.matchId);
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
    return res.status(400).json({
      error: "matchId, label, and kickoff are all required.",
    });
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
      };
      await db.write();
    });
  } catch (err) {
    return res.status(500).json({ error: "Server error saving match." });
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
    return res.status(500).json({ error: "Server error during reset." });
  }
 
  res.json({ status: "Reset complete", matchId });
});
 
// ════════════════════════════════════════
//  GET /admin/test-email
//  Sends a real test email so you can
//  confirm Gmail credentials are working.
//
//  Open this URL in your browser:
//  https://my-portfolio-production-9dd4.up.railway.app
//    /admin/test-email?secret=YOUR_ADMIN_SECRET
// ════════════════════════════════════════
app.get("/admin/test-email", adminLimiter, async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }
 
  if (!transporter) {
    return res.status(500).json({
      error: "Email transporter not initialised. Check GMAIL_USER and GMAIL_PASSWORD in Railway Variables.",
    });
  }
 
  try {
    const info = await transporter.sendMail({
      from:    `"Mundi Predict & Win" <${process.env.GMAIL_USER}>`,
      to:      "ntalenderick@gmail.com",
      subject: "✅ Mundi Email Test — Working!",
      text:
        "This is a test email from your Mundi Predict & Win server.\n\n" +
        "If you received this, your Gmail credentials are working correctly.\n\n" +
        "Sent from : " + process.env.GMAIL_USER + "\n" +
        "Time      : " + new Date().toUTCString(),
    });
 
    console.log("Test email sent OK:", info.messageId);
    res.json({
      status:    "Email sent successfully ✅",
      to:        "ntalenderick@gmail.com",
      messageId: info.messageId,
      note:      "Check your inbox and spam folder.",
    });
 
  } catch (err) {
    console.error("Test email failed:", err.message, "| code:", err.code);
    res.status(500).json({
      error: "Email failed: " + err.message,
      code:  err.code,
      fix:   err.code === "EAUTH"
        ? "Wrong Gmail credentials. Check GMAIL_PASSWORD in Railway has no spaces and is a valid App Password."
        : "Check Railway deploy logs for full error detail.",
    });
  }
});
 
// ════════════════════════════════════════
//  GRACEFUL SHUTDOWN
//  Flush pending email batch before Railway
//  restarts so no submissions are lost.
// ════════════════════════════════════════
process.on("SIGTERM", () => {
  console.log("SIGTERM received — flushing email batch...");
  flushBatch();
  setTimeout(() => process.exit(0), 2000);
});
 
// ════════════════════════════════════════
//  GLOBAL ERROR HANDLERS
// ════════════════════════════════════════
process.on("uncaughtException",  err => console.error("Uncaught exception:", err));
process.on("unhandledRejection", err => console.error("Unhandled rejection:", err));
 
// ════════════════════════════════════════
//  START
// ════════════════════════════════════════
const PORT = process.env.PORT || 3000;
 
initDB().then(() => {
  transporter = createTransporter();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});