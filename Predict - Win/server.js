require("dotenv").config();
 
const express    = require("express");
const cors       = require("cors");
const rateLimit  = require("express-rate-limit");
const nodemailer = require("nodemailer");
const { Low }    = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path       = require("path");
 
const app = express();
 
// ════════════════════════════════════════
//  CORS — only allow known frontend origins
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
//  RATE LIMITING
// ════════════════════════════════════════
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: "Too many submissions. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
 
const statusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
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
//  File: submissions.json (matches .gitignore)
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
//  EMAIL TRANSPORTER
// ════════════════════════════════════════
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASSWORD,
  },
});
 
// ════════════════════════════════════════
//  DEFAULT MATCHES
//  Change kickoff dates here each match
// ════════════════════════════════════════
const DEFAULT_MATCHES = {
  "match-001": {
    label:   "Liverpool vs PSG",
    kickoff: "2026-04-20T15:00:00Z",
  },
  "match-002": {
    label:   "Arsenal vs Chelsea",
    kickoff: "2026-04-20T17:30:00Z",
  },
};
 
function getAllMatches() {
  return { ...DEFAULT_MATCHES, ...db.data.matches };
}
 
// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
const sanitize = (str) =>
  String(str || "")
    .replace(/[<>"']/g, "")
    .trim()
    .slice(0, 100);
 
// Match end = kickoff + 2 hours (adjustable)
function getMatchEnd(kickoff) {
  return new Date(new Date(kickoff).getTime() + 2 * 60 * 60 * 1000);
}
 
// ════════════════════════════════════════
//  GET /status?matchId=match-001
//  Returns open/closed state + label + kickoff
//  Also returns matchEnded flag for auto-reset
// ════════════════════════════════════════
app.get("/status", statusLimiter, async (req, res) => {
  const { matchId } = req.query;
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
 
  await db.read();
  const count = (db.data.submissions[matchId] || []).length;
 
  res.json({
    open,
    ended,       // ← frontend uses this to auto-reset localStorage
    label:   match.label,
    kickoff: match.kickoff,
    matchEnd: matchEnd.toISOString(),
    total:   count,
  });
});
 
// ════════════════════════════════════════
//  POST /submit
// ════════════════════════════════════════
app.post("/submit", submitLimiter, async (req, res) => {
  const now  = new Date();
  const data = req.body;
 
  await db.read();
 
  const matches = getAllMatches();
  const match   = matches[data.matchId];
 
  // Validate match ID
  if (!match) {
    return res.status(404).json({ error: "Invalid match." });
  }
 
  // Block after kickoff
  if (now >= new Date(match.kickoff)) {
    return res.status(403).json({ error: "Predictions are closed. The match has started." });
  }
 
  // Sanitize all inputs
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
  const requiredText = ["name", "email", "phone", "teamA", "teamB",
                        "fhLeader", "shLeader", "winner"];
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
 
  // Validate goal values
  if (
    isNaN(clean.fhGoals) || isNaN(clean.shGoals) ||
    clean.fhGoals < 0   || clean.shGoals < 0     ||
    clean.fhGoals > 20  || clean.shGoals > 20
  ) {
    return res.status(400).json({ error: "Invalid goal values (must be 0–20)." });
  }
 
  // Check duplicate — email only (IP removed: unreliable on shared networks)
  db.data.submissions[data.matchId] ||= [];
  const alreadySubmitted = db.data.submissions[data.matchId]
    .some(entry => entry.email === clean.email);
 
  if (alreadySubmitted) {
    return res.status(409).json({
      error: "You have already submitted a prediction for this match.",
    });
  }
 
  // Save to database BEFORE sending email
  db.data.submissions[data.matchId].push({
    ...clean,
    submittedAt: now.toISOString(),
  });
  await db.write();
 
  // Send email notification
  const mailOptions = {
    from:    process.env.GMAIL_USER,
    to:      process.env.GMAIL_USER,
    subject: `⚽ New Prediction: ${clean.teamA} vs ${clean.teamB} — ${clean.name}`,
    text: `
====================================
  ⚽ NEW MATCH PREDICTION
====================================
 
PARTICIPANT DETAILS
------------------------------------
Name  : ${clean.name}
Email : ${clean.email}
Phone : ${clean.phone}
 
🏟 MATCH
${clean.teamA} vs ${clean.teamB}
 
FIRST HALF PREDICTION
------------------------------------
Leading Team : ${clean.fhLeader}
Total Goals  : ${clean.fhGoals}
 
SECOND HALF PREDICTION
------------------------------------
Leading Team : ${clean.shLeader}
Total Goals  : ${clean.shGoals}
 
FINAL RESULT PREDICTION
------------------------------------
Winner       : ${clean.winner}
 
====================================
Submitted at : ${now.toUTCString()}
====================================
    `,
  };
 
  try {
    await transporter.sendMail(mailOptions);
  } catch (emailErr) {
    // Prediction already saved — log email failure but don't fail the request
    console.error("Email notification failed:", emailErr.message);
  }
 
  res.json({ status: "success" });
});
 
// ════════════════════════════════════════
//  POST /admin/match — add a new match
// ════════════════════════════════════════
app.post("/admin/match", adminLimiter, async (req, res) => {
  const { secret, matchId, label, kickoff } = req.body;
 
  // Require admin secret
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }
 
  if (!matchId || !label || !kickoff) {
    return res.status(400).json({
      error: "matchId, label, and kickoff are all required.",
    });
  }
 
  if (isNaN(new Date(kickoff).getTime())) {
    return res.status(400).json({ error: "Invalid kickoff date format." });
  }
 
  await db.read();
  db.data.matches[sanitize(matchId)] = {
    label:   sanitize(label),
    kickoff: new Date(kickoff).toISOString(),
  };
  await db.write();
 
  res.json({ status: "Match added", matchId, label, kickoff });
});

// Public Route - Get all Matches
app.get("/matches", (req, res) => {
  res.json(getAllMatches());
})
 
// ════════════════════════════════════════
//  GET /admin/matches — list all matches
// ════════════════════════════════════════
app.get("/admin/matches", adminLimiter, (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  res.json(getAllMatches());
});
 
// ════════════════════════════════════════
//  GET /admin/submissions — view all entries
//  Protected by ADMIN_SECRET
// ════════════════════════════════════════
app.get("/admin/submissions", adminLimiter, async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }
  await db.read();
  res.json(db.data.submissions);
});
 
// ════════════════════════════════════════
//  POST /admin/reset — clear submissions
//  for a specific match after it ends
// ════════════════════════════════════════
app.post("/admin/reset", adminLimiter, async (req, res) => {
  const { secret, matchId } = req.body;
 
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }
 
  if (!matchId) {
    return res.status(400).json({ error: "matchId is required." });
  }
 
  await db.read();
  db.data.submissions[matchId] = [];
  await db.write();
 
  res.json({ status: "Reset complete", matchId });
});
 
// ════════════════════════════════════════
//  GLOBAL ERROR HANDLERS
// ════════════════════════════════════════
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});
 
process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});
 
// ════════════════════════════════════════
//  START SERVER
// ════════════════════════════════════════
const PORT = process.env.PORT || 3000;
 
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});