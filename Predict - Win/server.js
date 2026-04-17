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
//  RATE LIMITING
// ════════════════════════════════════════
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: "Too many submissions. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
 
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
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
 
// Send email in background — never blocks the HTTP response
function sendEmailAsync(mailOptions) {
  transporter.sendMail(mailOptions).catch(err => {
    console.error("Email notification failed:", err.message);
  });
}
 
// ════════════════════════════════════════
//  NO DEFAULT MATCHES — admin adds them all
//  Matches are only stored in the database
// ════════════════════════════════════════
function getAllMatches() {
  return { ...db.data.matches };
}
 
// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
const sanitize = (str) =>
  String(str || "")
    .replace(/[<>"']/g, "")
    .trim()
    .slice(0, 100);
 
// Match duration: 2 hours after kickoff
function getMatchEnd(kickoff) {
  return new Date(new Date(kickoff).getTime() + 2 * 60 * 60 * 1000);
}
 
// ════════════════════════════════════════
//  GET /matches  (public — used by frontend)
//  Returns only upcoming / currently active matches
//  Does NOT expose labels (admin-only info stripped)
//  Frontend only needs kickoff + matchId to drive
//  the countdown; label shown only in admin view.
// ════════════════════════════════════════
app.get("/matches", statusLimiter, async (req, res) => {
  await db.read();
  const matches = getAllMatches();
  const now = new Date();
 
  // Return all matches that haven't fully ended yet,
  // stripping the label so it never appears on the public page.
  const publicMatches = {};
  for (const id in matches) {
    const kickoff  = new Date(matches[id].kickoff);
    const matchEnd = getMatchEnd(kickoff);
    if (now < matchEnd) {
      publicMatches[id] = {
        kickoff: matches[id].kickoff,
        // label intentionally omitted — admin-only
      };
    }
  }
 
  res.json(publicMatches);
});
 
// ════════════════════════════════════════
//  GET /next-match  (public)
//  Returns the nearest upcoming match kickoff
//  so the frontend can show a "next match in X"
//  countdown after the current match ends.
// ════════════════════════════════════════
app.get("/next-match", statusLimiter, async (req, res) => {
  await db.read();
  const matches = getAllMatches();
  const now = new Date();
 
  let upcoming = [];
  for (const id in matches) {
    const kickoff = new Date(matches[id].kickoff);
    if (kickoff > now) {
      upcoming.push({ id, kickoff });
    }
  }
 
  if (upcoming.length === 0) {
    return res.json({ found: false });
  }
 
  upcoming.sort((a, b) => a.kickoff - b.kickoff);
  const next = upcoming[0];
 
  res.json({
    found: true,
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
 
  const count = (db.data.submissions[matchId] || []).length;
 
  res.json({
    open,
    ended,
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
 
  const requiredText = ["name", "email", "phone", "teamA", "teamB",
                        "fhLeader", "shLeader", "winner"];
  for (const field of requiredText) {
    if (!clean[field]) {
      return res.status(400).json({ error: `Missing field: ${field}` });
    }
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
 
  db.data.submissions[data.matchId] ||= [];
  const alreadySubmitted = db.data.submissions[data.matchId]
    .some(entry => entry.email === clean.email);
 
  if (alreadySubmitted) {
    return res.status(409).json({
      error: "You have already submitted a prediction for this match.",
    });
  }
 
  // Save first — respond fast
  db.data.submissions[data.matchId].push({
    ...clean,
    submittedAt: now.toISOString(),
  });
  await db.write();
 
  // Respond immediately — don't wait for email
  res.json({ status: "success" });
 
  // Send email in background (non-blocking)
  sendEmailAsync({
    from:    process.env.GMAIL_USER,
    to:      "ntalenderick@gmail.com",
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
(Match ID: ${data.matchId})
 
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
  });
});
 
// ════════════════════════════════════════
//  POST /admin/match — add a new match
// ════════════════════════════════════════
app.post("/admin/match", adminLimiter, async (req, res) => {
  const { secret, matchId, label, kickoff } = req.body;
 
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
 
// ════════════════════════════════════════
//  GET /admin/matches — list all matches (with labels)
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
//  START
// ════════════════════════════════════════
const PORT = process.env.PORT || 3000;
 
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
});