require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const nodemailer = require("nodemailer");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path = require("path");

const app = express();

// CORS 
app.use(cors({
  origin: ["http://127.0.0.1:5500", "http://localhost:5500"],
  methods: ["POST", "GET"],  
}));

app.use(bodyParser.json());

// Rate limiting 
const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: "Too many requests. Please try again later." },
});

const statusLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 30,
  message: { error: "Too many requests. Slow down." },
});

// Database setup 
const dbFile  = path.join(__dirname, "submissions.json");
const adapter = new JSONFile(dbFile);
const db      = new Low(adapter, { submissions: {}, matches: {} });

async function initDB() {
  await db.read();
  db.data.submissions = db.data.submissions || {};
  db.data.matches     = db.data.matches     || {};
  await db.write();
}

// Default matches 
const DEFAULT_MATCHES = {
  "match-001": {
    label:   "Liverpool vs PSG",
    kickoff: new Date("2026-04-20T15:00:00"),
  },
  "match-002": {
    label:   "Arsenal vs Chelsea",
    kickoff: new Date("2026-04-20T17:30:00"),
  },
};

// Email transporter 
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASSWORD,
  },
});

// Helper: get all matches (default + dynamic) 
function getAllMatches() {
  return { ...DEFAULT_MATCHES, ...db.data.matches };
}

// Helper: sanitize input 
const sanitize = (str) =>
  String(str).replace(/[<>"']/g, "").trim().slice(0, 100);


//  GET /status?matchId=match-001
app.get("/status", statusLimiter, (req, res) => {
  const { matchId } = req.query;
  const allMatches  = getAllMatches();

  if (!matchId || !allMatches[matchId]) {
    return res.status(404).json({ error: "Match not found." });
  }

  const match = allMatches[matchId];
  const now   = new Date();
  const open  = now < new Date(match.kickoff);

  res.json({  
    open,
    label:   match.label,
    kickoff: new Date(match.kickoff).toISOString(),
    message: open
      ? `Predictions close at ${new Date(match.kickoff).toUTCString()}`
      : "Predictions are closed. The match has started.",
  });
});

//  POST /submit
app.post("/submit", submitLimiter, async (req, res) => {
  const now         = new Date();
  const data        = req.body;
  const { matchId } = data;
  const allMatches  = getAllMatches();

  // Validate match ID
  if (!matchId || !allMatches[matchId]) {
    return res.status(404).json({ error: "Invalid match ID." });
  }

  // Block submissions after kick-off
  if (now >= new Date(allMatches[matchId].kickoff)) {
    return res.status(403).json({
      error: "Predictions are closed. The match has started.",
    });
  }

  // Validate required fields
  const required = [
    "name", "email", "phone", "teamA", "teamB",
    "fhLeader", "fhGoals", "shLeader", "shGoals", "winner",
  ];
  for (const field of required) {
    if (!data[field] && data[field] !== 0) {
      return res.status(400).json({ error: `Missing field: ${field}` });
    }
  }

  // Sanitize inputs
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

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(clean.email)) {
    return res.status(400).json({ error: "Invalid email address." });
  }

  // Validate goal numbers
  if (
    isNaN(clean.fhGoals) || isNaN(clean.shGoals) ||
    clean.fhGoals < 0   || clean.shGoals < 0     ||
    clean.fhGoals > 20  || clean.shGoals > 20
  ) {
    return res.status(400).json({ error: "Invalid goal numbers." });
  }

  // Read latest DB state
  await db.read();

  // Check duplicate per match
  const matchSubmissions = db.data.submissions[matchId] || [];
  if (matchSubmissions.includes(clean.email)) {
    return res.status(409).json({
      error: "You have already predicted for this match.",
    });
  }

  // Save to file BEFORE sending email 
  matchSubmissions.push(clean.email);
  db.data.submissions[matchId] = matchSubmissions;
  await db.write();

  // Send email 
  const mailOptions = {
    from:    process.env.GMAIL_USER,
    to:      process.env.GMAIL_USER,
    subject: `⚽ New Prediction: ${clean.teamA} vs ${clean.teamB} — ${clean.name}`,
    text: `


PARTICIPANT DETAILS
------------------------------------
Name  : ${clean.name}
Email : ${clean.email}
Phone : ${clean.phone}

MATCH [${matchId}]
------------------------------------
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


Submitted at : ${now.toUTCString()}

    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    res.json({ status: "success" });
  } catch (emailErr) {
    console.error("Email failed:", emailErr);
    res.json({
      status: "success",
      warning: "Prediction saved but email notification failed.",
    });
  }
});


//  POST /admin/match (add a new match)
app.post("/admin/match", async (req, res) => {
  const { secret, matchId, label, kickoff } = req.body;

  // Verify admin secret
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }

  // Validate inputs
  if (!matchId || !label || !kickoff) {
    return res.status(400).json({ error: "matchId, label and kickoff are required." }); // ✅ fixed: was 'kickodd'
  }

  if (isNaN(new Date(kickoff).getTime())) {
    return res.status(400).json({ error: "Invalid kickoff date." }); // ✅ fixed: was req.status
  }

  // Save new match to DB
  await db.read();
  db.data.matches[sanitize(matchId)] = {
    label:   sanitize(label),
    kickoff: new Date(kickoff).toISOString(),
  };
  await db.write();

  res.json({ status: "Match added", matchId, label, kickoff });
});


//  GET /admin/matches (list all matches)
app.get("/admin/matches", (req, res) => {
  const { secret } = req.query;

  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }

  res.json(getAllMatches());
});

// Global error handlers 
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Unhandled rejection:", err);
});

// Start server 
const PORT = process.env.PORT || 3000;

initDB().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});