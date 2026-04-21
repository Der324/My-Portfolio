// ════════════════════════════════════════
//  FORCE IPv4
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
//  TRUST PROXY
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
  message: { error: "Too many submissions. Please try again later." },
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
  db.data             ||= {};
  db.data.submissions ||= {};
  db.data.matches     ||= {};
  await db.write();
  console.log("Database ready.");
}
 
// ════════════════════════════════════════
//  WRITE QUEUE
// ════════════════════════════════════════
let writeQueue = Promise.resolve();
 
function queueWrite(fn) {
  writeQueue = writeQueue
    .then(fn)
    .catch(err => { console.error("Write queue error:", err); throw err; });
  return writeQueue;
}
 
// ════════════════════════════════════════
//  EMAIL — RESEND
//
//  WHY RESEND INSTEAD OF NODEMAILER:
//  Railway blocks all SMTP ports (25, 465, 587).
//  Nodemailer connects via SMTP so it always
//  fails on Railway with ETIMEDOUT or ESOCKET.
//  Resend uses HTTPS (port 443) which Railway
//  never blocks. Image 2 confirms Resend
//  successfully delivered on Apr 19 at 4:07 PM.
//
//  IMPORTANT — The previous Resend failure was
//  because onboarding@resend.dev can only
//  deliver to the email that OWNS the Resend
//  account. The fix is to verify
//  ntalenderick@gmail.com as a contact in
//  Resend dashboard → Contacts, OR use a
//  verified sending domain.
//
//  QUICKEST FIX (no domain needed):
//  1. Go to resend.com and log in
//  2. Go to Contacts → Add Contact
//  3. Add ntalenderick@gmail.com
//  4. This allows onboarding@resend.dev to
//     deliver to that address
//
//  Required Railway Variables:
//    RESEND_API_KEY = re_PXVJqRSv_... (your key)
//
//  DO NOT put RESEND_API_KEY in any code file.
//  Keep it only in Railway Variables.
// ════════════════════════════════════════
let resend = null;
 
function initResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("EMAIL CONFIG ERROR: RESEND_API_KEY missing from Railway Variables.");
    return null;
  }
  console.log("Email config OK — Resend API key found.");
  return new Resend(key);
}
 
// ════════════════════════════════════════
//  SEND EMAIL (fire-and-forget)
//  Prediction is always saved first.
//  Email failure never blocks the response.
// ════════════════════════════════════════
async function sendEmail(to, subject, text) {
  if (!resend) {
    console.error("Email skipped — Resend not initialised.");
    return;
  }
  try {
    const { data, error } = await resend.emails.send({
      from:    "Mundi Predict & Win <onboarding@resend.dev>",
      to:      [to],
      subject,
      text,
    });
    if (error) {
      console.error("Email FAILED:", error.message || JSON.stringify(error));
    } else {
      console.log("Email sent OK:", data.id);
    }
  } catch (err) {
    console.error("Email FAILED (exception):", err.message);
  }
}
 
// ════════════════════════════════════════
//  EMAIL BATCH QUEUE
//  Groups submissions within 60 seconds
//  into one email to avoid inbox flooding.
//  Flushed immediately on SIGTERM.
// ════════════════════════════════════════
let pendingBatch = [];
let batchTimer   = null;
 
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
 
  // ── Build clearly structured email body ──
  const lines = batch.map((item, i) => {
    const e = item.entry;
    return [
      `══════════════════════════════════════════`,
      `  PREDICTION ${i + 1} of ${count}`,
      `══════════════════════════════════════════`,
      ``,
      `  PARTICIPANT`,
      `  ───────────`,
      `  Name    : ${e.name}`,
      `  Email   : ${e.email}`,
      `  Phone   : ${e.phone}`,
      ``,
      `  MATCH  [${item.matchId}]`,
      `  ──────────────────────`,
      `  ${e.teamA}  vs  ${e.teamB}`,
      ``,
      `  ┌─────────────────────────────────────┐`,
      `  │         FIRST HALF PREDICTION       │`,
      `  ├─────────────────────────────────────┤`,
      `  │  Who leads at half time?            │`,
      `  │  → ${e.fhLeader.padEnd(33)}│`,
      `  │                                     │`,
      `  │  Total goals in first half?         │`,
      `  │  → ${String(e.fhGoals).padEnd(33)}│`,
      `  └─────────────────────────────────────┘`,
      ``,
      `  ┌─────────────────────────────────────┐`,
      `  │        SECOND HALF PREDICTION       │`,
      `  ├─────────────────────────────────────┤`,
      `  │  Who leads at full time?            │`,
      `  │  → ${e.shLeader.padEnd(33)}│`,
      `  │                                     │`,
      `  │  Total goals in second half?        │`,
      `  │  → ${String(e.shGoals).padEnd(33)}│`,
      `  └─────────────────────────────────────┘`,
      ``,
      `  ┌─────────────────────────────────────┐`,
      `  │           FINAL RESULT              │`,
      `  ├─────────────────────────────────────┤`,
      `  │  Match winner?                      │`,
      `  │  → ${e.winner.padEnd(33)}│`,
      `  └─────────────────────────────────────┘`,
      ``,
      `  Submitted : ${new Date(e.submittedAt).toLocaleString("en-RW", {
        timeZone:  "Africa/Kigali",
        dateStyle: "full",
        timeStyle: "medium",
      })} (Kigali)`,
    ].join("\n");
  }).join("\n\n");
 
  const subject = count === 1
    ? `⚽ 1 New Prediction — Mundi Predict & Win`
    : `⚽ ${count} New Predictions — Mundi Predict & Win`;
 
  const body =
    `${count} new prediction${count > 1 ? "s" : ""} received\n` +
    `─────────────────────────────────────────\n\n` +
    `${lines}\n\n` +
    `─────────────────────────────────────────\n` +
    `View all submissions in your admin panel.\n`;
 
  sendEmail("ntalenderick@gmail.com", subject, body);
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
//  GET /matches
// ════════════════════════════════════════
app.get("/matches", statusLimiter, async (req, res) => {
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
        label:   matches[id].label,
      };
    }
  }
 
  res.json(pub);
});
 
// ════════════════════════════════════════
//  GET /next-match
// ════════════════════════════════════════
app.get("/next-match", statusLimiter, async (req, res) => {
  await db.read();
  const matches  = getAllMatches();
  const now      = new Date();
  const upcoming = [];
 
  for (const id in matches) {
    const kickoff = new Date(matches[id].kickoff);
    if (kickoff > now) {
      upcoming.push({ id, kickoff, label: matches[id].label });
    }
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
//  GET /status
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
 
  // Validate required fields
  const requiredText = [
    "name", "email", "phone", "teamA", "teamB",
    "fhLeader", "shLeader", "winner",
  ];
  for (const field of requiredText) {
    if (!clean[field]) {
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
    return res.status(500).json({
      error: "Server error saving your prediction. Please try again.",
    });
  }
 
  if (!result || result.code !== 200) {
    return res
      .status(result ? result.code : 500)
      .json(result ? result.body : { error: "Unexpected server error." });
  }
 
  // Respond immediately — email is queued separately
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
//  Sends a real test to ntalenderick@gmail.com
//
//  Open in browser:
//  https://my-portfolio-production-9dd4.up.railway.app
//    /admin/test-email?secret=YOUR_ADMIN_SECRET
// ════════════════════════════════════════
app.get("/admin/test-email", adminLimiter, async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: "Unauthorized." });
  }
 
  if (!resend) {
    return res.status(500).json({
      error: "Resend not initialised. Check RESEND_API_KEY in Railway Variables.",
    });
  }
 
  try {
    const { data, error } = await resend.emails.send({
      from:    "Mundi Predict & Win <onboarding@resend.dev>",
      to:      ["ntalenderick@gmail.com"],
      subject: "✅ Mundi Email Test — Working!",
      text:
        "This is a test email from your Mundi Predict & Win server.\n\n" +
        "If you received this, Resend is delivering correctly.\n\n" +
        "Time : " + new Date().toUTCString(),
    });
 
    if (error) {
      console.error("Test email FAILED:", error);
      return res.status(500).json({
        error: "Resend rejected the email: " + (error.message || JSON.stringify(error)),
        fix:   "Go to resend.com → Contacts → add ntalenderick@gmail.com so onboarding@resend.dev can deliver to it.",
      });
    }
 
    console.log("Test email sent OK:", data.id);
    res.json({
      status:    "✅ Email sent successfully",
      to:        "ntalenderick@gmail.com",
      messageId: data.id,
      note:      "Check your inbox and spam folder. If not received, go to resend.com → Contacts and add ntalenderick@gmail.com.",
    });
 
  } catch (err) {
    console.error("Test email exception:", err.message);
    res.status(500).json({ error: "Exception: " + err.message });
  }
});
 
// ════════════════════════════════════════
//  GRACEFUL SHUTDOWN
// ════════════════════════════════════════
process.on("SIGTERM", () => {
  console.log("SIGTERM — flushing email batch...");
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
  resend = initResend();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});