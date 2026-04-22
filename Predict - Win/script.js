// ════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════
const API = "https://my-portfolio-production-9dd4.up.railway.app";
 
// ════════════════════════════════════════
//  MATCH DURATION: 90 MINUTES
//  A standard football match is 90 minutes.
// ════════════════════════════════════════
const MATCH_DURATION_MS = 90 * 60 * 1000;
 
let matchId        = null;
let storageKey     = null;
let countdownTimer = null;
 
// ════════════════════════════════════════
//  SCREEN MANAGER
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
//  POPULATE MATCH DISPLAY
//  Admin sets teamA, teamB, league.
//  Users see them as read-only.
// ════════════════════════════════════════
function populateMatchDisplay(match) {
  const teamA  = match.teamA  || "";
  const teamB  = match.teamB  || "";
  const league = match.league || "";
 
  // Hidden inputs for submit handler
  document.getElementById("teamA").value = teamA;
  document.getElementById("teamB").value = teamB;
 
  // Read-only display boxes
  document.getElementById("displayTeamA").innerText = teamA || "TBA";
  document.getElementById("displayTeamB").innerText = teamB || "TBA";
 
  // Header team display
  if (teamA && teamB) {
    document.getElementById("headerTeamA").innerText = teamA;
    document.getElementById("headerTeamB").innerText = teamB;
    document.getElementById("matchInfo").classList.remove("hidden");
  }
 
  // League badge
  const leagueEl = document.getElementById("matchLeague");
  if (leagueEl) {
    leagueEl.innerText      = league;
    leagueEl.style.display  = league ? "block" : "none";
  }
 
  // Radio card labels — show actual team names
  if (teamA) {
    document.getElementById("fhHomeLabel").innerText      = teamA;
    document.getElementById("shHomeLabel").innerText      = teamA;
    document.getElementById("winnerHomeLabel").innerText  = teamA;
  }
  if (teamB) {
    document.getElementById("fhAwayLabel").innerText      = teamB;
    document.getElementById("shAwayLabel").innerText      = teamB;
    document.getElementById("winnerAwayLabel").innerText  = teamB;
  }
}
 
// ════════════════════════════════════════
//  FETCH ACTIVE MATCH FROM SERVER
// ════════════════════════════════════════
async function getActiveMatch() {
  try {
    const res     = await fetch(`${API}/matches`);
    const matches = await res.json();
    const now     = new Date();
 
    const active = [];
    for (const id in matches) {
      const kickoff = new Date(matches[id].kickoff);
      const end     = new Date(kickoff.getTime() + MATCH_DURATION_MS);
      // Include upcoming AND in-progress matches
      if (now < end) active.push({ id, ...matches[id], kickoff });
    }
 
    if (active.length === 0) return null;
 
    active.sort((a, b) => a.kickoff - b.kickoff);
    const selected = active[0];
 
    matchId    = selected.id;
    storageKey = `predicted_${matchId}`;
 
    return selected;
 
  } catch (err) {
    console.error("Failed to fetch matches:", err);
    return { networkError: true };
  }
}
 
// ════════════════════════════════════════
//  FETCH NEXT UPCOMING MATCH
// ════════════════════════════════════════
async function getNextMatch() {
  try {
    const res  = await fetch(`${API}/next-match`);
    const data = await res.json();
    return data.found ? data : null;
  } catch {
    return null;
  }
}
 
// ════════════════════════════════════════
//  INIT — loads match and decides which
//  screen to show
// ════════════════════════════════════════
async function init() {
  let matchResult = await getActiveMatch();
 
  // Retry once for Railway cold starts (~2s delay)
  if (matchResult && matchResult.networkError) {
    await new Promise(r => setTimeout(r, 2500));
    matchResult = await getActiveMatch();
  }
 
  if (matchResult && matchResult.networkError) {
    showOnly("matchEndedMsg");
    const el = document.getElementById("countdown");
    if (el) el.innerText = "⚠️ Could not connect — please refresh";
    return;
  }
 
  if (!matchResult) {
    showOnly("matchEndedMsg");
    startPostMatchCountdown();
    return;
  }
 
  // Show team names and league from server data
  populateMatchDisplay(matchResult);
 
  const kickoff = new Date(matchResult.kickoff);
  const now     = new Date();
 
  try {
    const res    = await fetch(`${API}/status?matchId=${matchId}`);
    const status = await res.json();
 
    // Match has fully ended (90 min after kickoff)
    if (status.ended) {
      showOnly("matchEndedMsg");
      // ════════════════════════════════
      //  AUTO-RESET localStorage
      //  When match ends, clear the user's
      //  submission record so they can
      //  predict on the next match.
      // ════════════════════════════════
      if (storageKey) localStorage.removeItem(storageKey);
      startPostMatchCountdown();
      return;
    }
 
    // Match has kicked off — predictions closed
    if (!status.open) {
      showOnly("closedMsg");
      startPreMatchCountdown(kickoff);
      return;
    }
 
    // ════════════════════════════════
    //  ONE SUBMISSION PER MATCH
    //  localStorage is a UX convenience.
    //  The server enforces the real limit
    //  via email duplicate check.
    // ════════════════════════════════
    if (localStorage.getItem(storageKey)) {
      showOnly("alreadySubmitted");
    } else {
      showOnly("predictionForm");
    }
 
    startPreMatchCountdown(kickoff);
 
  } catch (err) {
    console.error("Status check failed:", err);
    showOnly("matchEndedMsg");
    startPostMatchCountdown();
  }
}
 
init();
 
// ════════════════════════════════════════
//  COUNTDOWN — pre-match (predictions open)
//  and in-match (predictions closed, 90min)
// ════════════════════════════════════════
function startPreMatchCountdown(kickoff) {
  if (countdownTimer) clearTimeout(countdownTimer);
 
  const el       = document.getElementById("countdown");
  const matchEnd = new Date(kickoff.getTime() + MATCH_DURATION_MS);
 
  function update() {
    const now = new Date();
 
    if (now < kickoff) {
      // Before kickoff — predictions open
      const diff = kickoff - now;
      const h    = Math.floor(diff / 3600000);
      const m    = Math.floor((diff % 3600000) / 60000);
      const s    = Math.floor((diff % 60000) / 1000);
 
      if (h > 0) {
        el.innerText = `⏱ Predictions close in ${h}h ${pad(m)}m ${pad(s)}s`;
      } else {
        el.innerText = `⏱ Predictions close in ${pad(m)}m ${pad(s)}s`;
      }
 
    } else if (now < matchEnd) {
      // After kickoff — match in progress (90 minutes)
      const diff     = matchEnd - now;
      const minLeft  = Math.floor(diff / 60000);
      const secLeft  = Math.floor((diff % 60000) / 1000);
      const minPlayed = 90 - minLeft;
 
      el.innerText = `⏳ Match in progress — ${minPlayed}' played`;
 
      // Switch screen to "closed" if still showing form
      const closed = document.getElementById("closedMsg");
      if (closed && closed.classList.contains("hidden")) {
        showOnly("closedMsg");
      }
 
    } else {
      // Match ended
      el.innerText = "";
      if (storageKey) localStorage.removeItem(storageKey);
      showOnly("matchEndedMsg");
      startPostMatchCountdown();
      return;
    }
 
    countdownTimer = setTimeout(update, 1000);
  }
 
  update();
}
 
// ════════════════════════════════════════
//  COUNTDOWN — post-match
//  Shows time until next match
// ════════════════════════════════════════
async function startPostMatchCountdown() {
  if (countdownTimer) clearTimeout(countdownTimer);
 
  const el   = document.getElementById("countdown");
  const next = await getNextMatch();
 
  if (!next) { el.innerText = ""; return; }
 
  const nextKickoff = new Date(next.kickoff);
 
  function update() {
    const now  = new Date();
    const diff = nextKickoff - now;
 
    if (diff <= 0) {
      el.innerText = "🎯 Next match starting now!";
      setTimeout(() => location.reload(), 3000);
      return;
    }
 
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
 
    el.innerText = d > 0
      ? `🎯 Next match in ${d}d ${h}h ${pad(m)}m`
      : `🎯 Next match in ${h}h ${pad(m)}m ${pad(s)}s`;
 
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
//  RESOLVE TEAM — radio value → team name
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
  ["name", "email", "phone", "fhGoals", "shGoals"].forEach(clearError);
  ["fhLeader-error", "shLeader-error", "winner-error"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = "";
  });
}
 
function validateForm(d) {
  let valid = true;
  clearAllErrors();
 
  if (!d.name.trim()) {
    showError("name", "Please enter your full name.");
    valid = false;
  }
 
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!d.email.trim()) {
    showError("email", "Please enter your email address.");
    valid = false;
  } else if (!emailRegex.test(d.email)) {
    showError("email", "Please enter a valid email address.");
    valid = false;
  }
 
  if (!d.phone.trim()) {
    showError("phone", "Please enter your phone number.");
    valid = false;
  }
 
  if (!d.fhLeaderRaw) {
    document.getElementById("fhLeader-error").innerText = "Please select who leads at half time.";
    valid = false;
  }
  if (!d.shLeaderRaw) {
    document.getElementById("shLeader-error").innerText = "Please select who leads at full time.";
    valid = false;
  }
  if (!d.winnerRaw) {
    document.getElementById("winner-error").innerText = "Please select the match winner.";
    valid = false;
  }
 
  return valid;
}
 
// ════════════════════════════════════════
//  FORM SUBMISSION
// ════════════════════════════════════════
document.getElementById("predictionForm")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
 
    const btn  = document.getElementById("submitBtn");
    const msg  = document.getElementById("msg");
 
    // Team names from hidden inputs (populated from server data)
    const teamA = document.getElementById("teamA").value;
    const teamB = document.getElementById("teamB").value;
 
    const fhLeaderRaw = document.querySelector('input[name="fhLeader"]:checked')?.value;
    const shLeaderRaw = document.querySelector('input[name="shLeader"]:checked')?.value;
    const winnerRaw   = document.querySelector('input[name="winner"]:checked')?.value;
 
    const raw = {
      name:       document.getElementById("name").value,
      email:      document.getElementById("email").value,
      phone:      document.getElementById("phone").value,
      fhLeaderRaw,
      shLeaderRaw,
      winnerRaw,
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
      fhGoals:  document.getElementById("fhGoals").value,
      shLeader: resolveTeam(shLeaderRaw, teamA, teamB),
      shGoals:  document.getElementById("shGoals").value,
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
        // Lock this match in localStorage (UX guard — server is the real guard)
        localStorage.setItem(storageKey, "true");
        showOnly("alreadySubmitted");
        window.scrollTo({ top: 0, behavior: "smooth" });
 
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