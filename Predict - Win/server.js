require("dotenv").config();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path = require("path");

const app = express();

// ════════════════════════════════════════
//  MIDDLEWARE
// ════════════════════════════════════════
app.use(cors({
  origin: [
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "https://der324.github.io",
    "https://my-portfolio-production-9dd4.up.railway.app"
  ]
}));

app.use(express.json());

// Rate limiting
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many submissions. Try again later." }
});

const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60
});

// ════════════════════════════════════════
//  DATABASE
// ════════════════════════════════════════
const dbFile  = path.join(__dirname, "db.json");
const adapter = new JSONFile(dbFile);
const db      = new Low(adapter, { submissions: {}, matches: {} });

async function initDB() {
  await db.read();
  db.data ||= { submissions: {}, matches: {} };
  await db.write();
}

// ════════════════════════════════════════
//  DEFAULT MATCHES (SERVER CONTROLS THIS)
// ════════════════════════════════════════
const DEFAULT_MATCHES = {
  "match-001": {
    label: "Liverpool vs PSG",
    kickoff: "2026-04-20T15:00:00Z"
  },
  "match-002": {
    label: "Arsenal vs Chelsea",
    kickoff: "2026-04-20T17:30:00Z"
  }
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

// ════════════════════════════════════════
//  GET /status
// ════════════════════════════════════════
app.get("/status", statusLimiter, async (req, res) => {
  const { matchId } = req.query;
  const matches = getAllMatches();

  if (!matchId || !matches[matchId]) {
    return res.status(404).json({ error: "Match not found." });
  }

  const match = matches[matchId];
  const now   = new Date();
  const open  = now < new Date(match.kickoff);

  await db.read();
  const submissions = db.data.submissions[matchId] || [];

  res.json({
    open,
    label: match.label,
    kickoff: match.kickoff,
    total: submissions.length
  });
});

// ════════════════════════════════════════
//  POST /submit (UPDATED CORE)
// ════════════════════════════════════════
app.post("/submit", submitLimiter, async (req, res) => {
  const now = new Date();
  const data = req.body;

  await db.read();

  const matches = getAllMatches();
  const match = matches[data.matchId];

  // Validate match
  if (!match) {
    return res.status(404).json({ error: "Invalid match." });
  }

  // Check time
  if (now >= new Date(match.kickoff)) {
    return res.status(403).json({ error: "Predictions closed." });
  }

  // Sanitize input
  const clean = {
    name: sanitize(data.name),
    email: sanitize(data.email).toLowerCase(),
    phone: sanitize(data.phone),
    teamA: sanitize(data.teamA),
    teamB: sanitize(data.teamB),
    fhLeader: sanitize(data.fhLeader),
    fhGoals: parseInt(data.fhGoals),
    shLeader: sanitize(data.shLeader),
    shGoals: parseInt(data.shGoals),
    winner: sanitize(data.winner),
  };

  // Validate required fields
  const required = [
    "name","email","phone","teamA","teamB",
    "fhLeader","fhGoals","shLeader","shGoals","winner"
  ];

  for (const field of required) {
    if (!clean[field] && clean[field] !== 0) {
      return res.status(400).json({ error: `Missing field: ${field}` });
    }
  }

  // Validate email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(clean.email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  // Validate goals
  if (
    isNaN(clean.fhGoals) || isNaN(clean.shGoals) ||
    clean.fhGoals < 0 || clean.shGoals < 0 ||
    clean.fhGoals > 20 || clean.shGoals > 20
  ) {
    return res.status(400).json({ error: "Invalid goal values." });
  }

  // Identify user (IP)
  const ip =
    req.headers["x-forwarded-for"] ||
    req.socket.remoteAddress ||
    "unknown";

  // Prepare storage
  db.data.submissions[data.matchId] ||= [];

  // Check duplicates (email OR IP)
  const exists = db.data.submissions[data.matchId].find(
    entry => entry.email === clean.email || entry.ip === ip
  );

  if (exists) {
    return res.status(409).json({ error: "You already submitted." });
  }

  // Save full entry
  db.data.submissions[data.matchId].push({
    ...clean,
    ip,
    submittedAt: now.toISOString()
  });

  await db.write();

  res.json({ status: "success" });
});

// ════════════════════════════════════════
//  ADMIN: VIEW SUBMISSIONS
// ════════════════════════════════════════
app.get("/admin/submissions", async (req, res) => {
  await db.read();
  res.json(db.data.submissions);
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