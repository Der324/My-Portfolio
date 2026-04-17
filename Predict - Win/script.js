// ════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════
const API = "https://my-portfolio-production-9dd4.up.railway.app";
 
let matchId   = null;
let storageKey = null;
let countdownTimer = null;
 
// ════════════════════════════════════════
//  SHOW / HIDE SCREENS
// ════════════════════════════════════════
function showOnly(id) {
  const screens = [
    "predictionForm",
    "noMatchMsg",
    "alreadySubmitted",
    "closedMsg",
    "matchEndedMsg",
  ];
  screens.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle("hidden", s !== id);
  });
}
 
// ════════════════════════════════════════
//  FETCH ACTIVE MATCH (PUBLIC)
//  NOTE: /matches no longer returns labels —
//  the match label is admin-only information.
//  The header subtitle stays as-is from HTML.
// ════════════════════════════════════════
async function getActiveMatch() {
  try {
    const res     = await fetch(`${API}/matches`);
    const matches = await res.json();
 
    const now = new Date();
    let activeMatches = [];
 
    for (const id in matches) {
      const kickoff = new Date(matches[id].kickoff);
      const end     = new Date(kickoff.getTime() + 2 * 60 * 60 * 1000);
 
      if (now < end) {
        activeMatches.push({ id, ...matches[id], kickoff });
      }
    }
 
    if (activeMatches.length === 0) return null;
 
    // Pick nearest kickoff
    activeMatches.sort((a, b) => a.kickoff - b.kickoff);
    const selected = activeMatches[0];
 
    matchId    = selected.id;
    storageKey = `predicted_${matchId}`;
 
    return selected;
 
  } catch (err) {
    console.error("Failed to fetch matches", err);
    return null;
  }
}
 
// ════════════════════════════════════════
//  FETCH NEXT UPCOMING MATCH
//  Used after a match ends to show a
//  "next match in X" countdown.
// ════════════════════════════════════════
async function getNextMatch() {
  try {
    const res  = await fetch(`${API}/next-match`);
    const data = await res.json();
    return data.found ? data : null;
  } catch (err) {
    console.error("Failed to fetch next match", err);
    return null;
  }
}
 
// ════════════════════════════════════════
//  INIT
// ════════════════════════════════════════
async function init() {
  // Clear the match label — it's admin-only
  const matchLabelEl = document.getElementById("matchLabel");
  if (matchLabelEl) matchLabelEl.innerText = "";
 
  const match = await getActiveMatch();
 
  if (!match) {
    // No active or upcoming match at all
    showOnly("matchEndedMsg");
    // Still try to show a countdown to the next match
    startPostMatchCountdown();
    return;
  }
 
  const kickoff = new Date(match.kickoff);
 
  try {
    const res    = await fetch(`${API}/status?matchId=${matchId}`);
    const status = await res.json();
 
    if (status.ended) {
      showOnly("matchEndedMsg");
      startPostMatchCountdown();
      return;
    }
 
    if (!status.open) {
      // Match has kicked off — predictions closed
      showOnly("closedMsg");
      startPreMatchCountdown(kickoff);
      return;
    }
 
    // Predictions open
    if (localStorage.getItem(storageKey)) {
      showOnly("alreadySubmitted");
    } else {
      showOnly("predictionForm");
    }
 
    startPreMatchCountdown(kickoff);
 
  } catch (err) {
    console.error("Status check failed", err);
    showOnly("matchEndedMsg");
    startPostMatchCountdown();
  }
}
 
init();
 
// ════════════════════════════════════════
//  COUNTDOWN — PHASE 1
//  Shows "Match starts in X" until kickoff.
//  Switches to "closed" state at kickoff and
//  counts down the remaining match time.
//  When match ends, switches to phase 2.
// ════════════════════════════════════════
function startPreMatchCountdown(kickoff) {
  if (countdownTimer) clearTimeout(countdownTimer);
 
  const el       = document.getElementById("countdown");
  const matchEnd = new Date(kickoff.getTime() + 2 * 60 * 60 * 1000);
 
  function update() {
    const now = new Date();
 
    if (now < kickoff) {
      // Before kickoff — show time to match start
      const diff = kickoff - now;
      const h    = Math.floor(diff / 3600000);
      const m    = Math.floor((diff % 3600000) / 60000);
      const s    = Math.floor((diff % 60000) / 1000);
 
      el.innerText = `⏱ Predictions close in ${h}h ${pad(m)}m ${pad(s)}s`;
 
    } else if (now < matchEnd) {
      // Match in progress — show time until predictions re-open for next match
      const diff = matchEnd - now;
      const m    = Math.floor(diff / 60000);
      const s    = Math.floor((diff % 60000) / 1000);
 
      el.innerText = `⏳ Match in progress — ends in ${m}m ${pad(s)}s`;
 
      // Switch UI to "closed" if it isn't already
      const closed = document.getElementById("closedMsg");
      if (closed && closed.classList.contains("hidden")) {
        showOnly("closedMsg");
      }
 
    } else {
      // Match over — switch to post-match countdown
      el.innerText = "";
      showOnly("matchEndedMsg");
      startPostMatchCountdown();
      return;
    }
 
    countdownTimer = setTimeout(update, 1000);
  }
 
  update();
}
 
// ════════════════════════════════════════
//  COUNTDOWN — PHASE 2
//  After a match ends, fetches the next
//  scheduled match and counts down to it.
//  If no next match exists, hides countdown.
// ════════════════════════════════════════
async function startPostMatchCountdown() {
  if (countdownTimer) clearTimeout(countdownTimer);
 
  const el   = document.getElementById("countdown");
  const next = await getNextMatch();
 
  if (!next) {
    el.innerText = "";
    return;
  }
 
  const nextKickoff = new Date(next.kickoff);
 
  function update() {
    const now  = new Date();
    const diff = nextKickoff - now;
 
    if (diff <= 0) {
      // Next match is starting — reload to pick it up
      el.innerText = "🎯 Next match starting now!";
      setTimeout(() => location.reload(), 3000);
      return;
    }
 
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
 
    if (d > 0) {
      el.innerText = `🎯 Next match in ${d}d ${h}h ${pad(m)}m`;
    } else {
      el.innerText = `🎯 Next match in ${h}h ${pad(m)}m ${pad(s)}s`;
    }
 
    countdownTimer = setTimeout(update, 1000);
  }
 
  update();
}
 
// ════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════
function pad(n) { return String(n).padStart(2, "0"); }
 
// ════════════════════════════════════════
//  NUMBER STEPPER
// ════════════════════════════════════════
document.querySelectorAll(".num-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
 
    let val = parseInt(input.value) || 0;
    if (btn.dataset.action === "inc" && val < 20) val++;
    if (btn.dataset.action === "dec" && val > 0)  val--;
 
    input.value = val;
    input.dispatchEvent(new Event("input"));
  });
});
 
// ════════════════════════════════════════
//  LIVE TEAM LABELS
// ════════════════════════════════════════
document.getElementById("teamA").addEventListener("input", function () {
  const name = this.value.trim() || "Home Team";
  document.getElementById("fhHomeLabel").innerText    = name;
  document.getElementById("shHomeLabel").innerText    = name;
  document.getElementById("winnerHomeLabel").innerText = name;
});
 
document.getElementById("teamB").addEventListener("input", function () {
  const name = this.value.trim() || "Away Team";
  document.getElementById("fhAwayLabel").innerText    = name;
  document.getElementById("shAwayLabel").innerText    = name;
  document.getElementById("winnerAwayLabel").innerText = name;
});
 
// ════════════════════════════════════════
//  RESOLVE TEAM
// ════════════════════════════════════════
function resolveTeam(value, teamA, teamB) {
  if (value === "home") return teamA;
  if (value === "away") return teamB;
  return "Draw";
}
 
// ════════════════════════════════════════
//  VALIDATION
// ════════════════════════════════════════
function showError(fieldId, message) {
  const input = document.getElementById(fieldId);
  const error = document.getElementById(`${fieldId}-error`);
  if (input) input.classList.add("is-error");
  if (error) error.innerText = message;
}
 
function clearError(fieldId) {
  const input = document.getElementById(fieldId);
  const error = document.getElementById(`${fieldId}-error`);
  if (input) input.classList.remove("is-error");
  if (error) error.innerText = "";
}
 
function clearAllErrors() {
  ["name", "email", "phone", "teamA", "teamB", "fhGoals", "shGoals"]
    .forEach(clearError);
  ["fhLeader-error", "shLeader-error", "winner-error"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = "";
  });
}
 
function validateForm(d) {
  let valid = true;
  clearAllErrors();
 
  if (!d.name.trim())  { showError("name",  "Enter your name"); valid = false; }
 
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(d.email)) { showError("email", "Invalid email"); valid = false; }
 
  if (!d.phone.trim()) { showError("phone", "Enter phone");      valid = false; }
  if (!d.teamA.trim()) { showError("teamA", "Enter home team");  valid = false; }
  if (!d.teamB.trim()) { showError("teamB", "Enter away team");  valid = false; }
 
  if (!d.fhLeaderRaw) { document.getElementById("fhLeader-error").innerText = "Required"; valid = false; }
  if (!d.shLeaderRaw) { document.getElementById("shLeader-error").innerText = "Required"; valid = false; }
  if (!d.winnerRaw)   { document.getElementById("winner-error").innerText   = "Required"; valid = false; }
 
  return valid;
}
 
// ════════════════════════════════════════
//  SUBMIT
// ════════════════════════════════════════
document.getElementById("predictionForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
 
    const btn = document.getElementById("submitBtn");
    const msg = document.getElementById("msg");
 
    const teamA = document.getElementById("teamA").value.trim();
    const teamB = document.getElementById("teamB").value.trim();
 
    const fhLeaderRaw = document.querySelector('input[name="fhLeader"]:checked')?.value;
    const shLeaderRaw = document.querySelector('input[name="shLeader"]:checked')?.value;
    const winnerRaw   = document.querySelector('input[name="winner"]:checked')?.value;
 
    const raw = {
      name:       document.getElementById("name").value,
      email:      document.getElementById("email").value,
      phone:      document.getElementById("phone").value,
      teamA,
      teamB,
      fhLeaderRaw,
      shLeaderRaw,
      winnerRaw,
      fhGoals:    document.getElementById("fhGoals").value,
      shGoals:    document.getElementById("shGoals").value,
    };
 
    if (!validateForm(raw)) return;
 
    const payload = {
      matchId,
      name:     raw.name.trim(),
      email:    raw.email.trim(),
      phone:    raw.phone.trim(),
      teamA,
      teamB,
      fhLeader: resolveTeam(fhLeaderRaw, teamA, teamB),
      fhGoals:  raw.fhGoals,
      shLeader: resolveTeam(shLeaderRaw, teamA, teamB),
      shGoals:  raw.shGoals,
      winner:   resolveTeam(winnerRaw, teamA, teamB),
    };
 
    btn.disabled = true;
    btn.querySelector(".submit-btn__text").innerText = "Submitting…";
    msg.innerText = "";
    msg.className = "form-msg";
 
    try {
      const res = await fetch(`${API}/submit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
 
      if (res.ok) {
        localStorage.setItem(storageKey, "true");
        showOnly("alreadySubmitted");
      } else {
        const body = await res.json().catch(() => ({}));
        msg.innerText = body.error || "Submission failed. Please try again.";
        msg.className = "form-msg error";
        btn.disabled  = false;
        btn.querySelector(".submit-btn__text").innerText = "Submit My Prediction";
      }
 
    } catch {
      msg.innerText = "Network error — please check your connection.";
      msg.className = "form-msg error";
      btn.disabled  = false;
      btn.querySelector(".submit-btn__text").innerText = "Submit My Prediction";
    }
  });