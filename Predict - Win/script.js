// ════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════
const API = "https://my-portfolio-production-9dd4.up.railway.app";
 
// ════════════════════════════════════════
//  MATCH ID FROM URL
// ════════════════════════════════════════
const params  = new URLSearchParams(window.location.search);
const matchId = params.get("match");
const storageKey = `predicted_${matchId}`;
 
// ════════════════════════════════════════
//  HELPERS — show / hide screens
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
//  AUTO-RESET — clears localStorage for
//  this match after the match has ended
//  (server match_end = kickoff + 2 hours)
// ════════════════════════════════════════
function scheduleReset(kickoff) {
  // A typical match lasts ~2 hours after kickoff
  const matchEnd = new Date(kickoff.getTime() + 2 * 60 * 60 * 1000);
  const now      = new Date();
 
  if (now >= matchEnd) {
    // Match already over — clear prediction record immediately
    localStorage.removeItem(storageKey);
    return true; // signal: match ended
  }
 
  // Schedule reset at match end
  const msUntilEnd = matchEnd - now;
  setTimeout(() => {
    localStorage.removeItem(storageKey);
    // Show match ended screen quietly
    showOnly("matchEndedMsg");
  }, msUntilEnd);
 
  return false;
}
 
// ════════════════════════════════════════
//  INITIAL STATE — No match ID
// ════════════════════════════════════════
if (!matchId) {
  showOnly("noMatchMsg");
}
 
// ════════════════════════════════════════
//  CHECK SERVER MATCH STATUS
// ════════════════════════════════════════
async function checkMatchStatus() {
  if (!matchId) return;
 
  try {
    const res  = await fetch(`${API}/status?matchId=${matchId}`);
    const data = await res.json();
 
    // Show match label in header
    if (data.label) {
      document.getElementById("matchLabel").innerText = data.label;
    }
 
    const kickoff = new Date(data.kickoff);
 
    // Check if match has already ended (kickoff + 2h)
    const matchEnded = scheduleReset(kickoff);
 
    if (matchEnded) {
      showOnly("matchEndedMsg");
      return;
    }
 
    if (!data.open) {
      // Predictions closed but match not yet ended — show closed screen
      showOnly("closedMsg");
      return;
    }
 
    // Predictions still open — check if THIS user already submitted
    if (localStorage.getItem(storageKey)) {
      showOnly("alreadySubmitted");
    } else {
      showOnly("predictionForm");
      startCountdown(kickoff);
    }
 
  } catch {
    // Server unreachable — fall back to localStorage check
    console.warn("Could not reach server.");
    if (localStorage.getItem(storageKey)) {
      showOnly("alreadySubmitted");
    } else {
      showOnly("predictionForm");
    }
  }
}
 
checkMatchStatus();
 
// ════════════════════════════════════════
//  COUNTDOWN TIMER
// ════════════════════════════════════════
function startCountdown(kickoff) {
  const el = document.getElementById("countdown");
  if (!el) return;
 
  function update() {
    const diff = kickoff - new Date();
 
    if (diff <= 0) {
      el.innerText = "⛔ Predictions are now closed";
      showOnly("closedMsg");
      return;
    }
 
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
 
    el.innerText =
      `⏱ Closes in ${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
 
    setTimeout(update, 1000);
  }
 
  update();
}
 
// ════════════════════════════════════════
//  NUMBER STEPPER BUTTONS
// ════════════════════════════════════════
document.querySelectorAll(".num-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const input  = document.getElementById(btn.dataset.target);
    if (!input) return;
    let val = parseInt(input.value) || 0;
 
    if (btn.dataset.action === "inc" && val < 20) val++;
    if (btn.dataset.action === "dec" && val > 0)  val--;
 
    input.value = val;
    // Trigger error clear
    input.dispatchEvent(new Event("input"));
  });
});
 
// ════════════════════════════════════════
//  LIVE TEAM NAME LABELS
// ════════════════════════════════════════
document.getElementById("teamA").addEventListener("input", function () {
  const name = this.value.trim() || "Home Team";
  document.getElementById("fhHomeLabel").innerText      = name;
  document.getElementById("shHomeLabel").innerText      = name;
  document.getElementById("winnerHomeLabel").innerText  = name;
});
 
document.getElementById("teamB").addEventListener("input", function () {
  const name = this.value.trim() || "Away Team";
  document.getElementById("fhAwayLabel").innerText      = name;
  document.getElementById("shAwayLabel").innerText      = name;
  document.getElementById("winnerAwayLabel").innerText  = name;
});
 
// ════════════════════════════════════════
//  RESOLVE RADIO VALUE → TEAM NAME
// ════════════════════════════════════════
function resolveTeam(value, teamA, teamB) {
  if (value === "home") return teamA;
  if (value === "away") return teamB;
  return "Draw";
}
 
// ════════════════════════════════════════
//  VALIDATION HELPERS
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
 
// Clear error as user types
["name", "email", "phone", "teamA", "teamB", "fhGoals", "shGoals"]
  .forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => clearError(id));
  });
 
// ════════════════════════════════════════
//  FULL FORM VALIDATION
// ════════════════════════════════════════
function validateForm(d) {
  let valid = true;
  clearAllErrors();
 
  // Name
  if (!d.name.trim()) {
    showError("name", "Please enter your full name.");
    valid = false;
  }
 
  // Email — format checked on client too
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!d.email.trim()) {
    showError("email", "Please enter your email address.");
    valid = false;
  } else if (!emailRegex.test(d.email.trim())) {
    showError("email", "Please enter a valid email (e.g. john@email.com).");
    valid = false;
  }
 
  // Phone
  if (!d.phone.trim()) {
    showError("phone", "Please enter your phone number.");
    valid = false;
  }
 
  // Teams
  if (!d.teamA.trim()) {
    showError("teamA", "Please enter the home team name.");
    valid = false;
  }
  if (!d.teamB.trim()) {
    showError("teamB", "Please enter the away team name.");
    valid = false;
  }
 
  // Radio selections
  if (!d.fhLeaderRaw) {
    document.getElementById("fhLeader-error").innerText =
      "Please select who leads at half time.";
    valid = false;
  }
  if (!d.shLeaderRaw) {
    document.getElementById("shLeader-error").innerText =
      "Please select who leads at full time.";
    valid = false;
  }
  if (!d.winnerRaw) {
    document.getElementById("winner-error").innerText =
      "Please select the match winner.";
    valid = false;
  }
 
  // Goals
  const fhG = parseInt(d.fhGoals);
  const shG = parseInt(d.shGoals);
  if (isNaN(fhG) || fhG < 0 || fhG > 20) {
    showError("fhGoals", "Enter a valid number of goals (0–20).");
    valid = false;
  }
  if (isNaN(shG) || shG < 0 || shG > 20) {
    showError("shGoals", "Enter a valid number of goals (0–20).");
    valid = false;
  }
 
  return valid;
}
 
// ════════════════════════════════════════
//  BUTTON STATE HELPERS
// ════════════════════════════════════════
function setButtonLoading(btn) {
  btn.disabled = true;
  btn.querySelector(".submit-btn__text").innerText = "Submitting…";
  btn.querySelector(".submit-btn__icon").innerText = "⏳";
}
 
function resetButton(btn) {
  btn.disabled = false;
  btn.querySelector(".submit-btn__text").innerText = "Submit My Prediction";
  btn.querySelector(".submit-btn__icon").innerText = "→";
}
 
// ════════════════════════════════════════
//  FORM SUBMISSION
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
 
    // Collect for validation
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
 
    // Validate — stop if errors
    if (!validateForm(raw)) {
      const firstError = document.querySelector(".is-error, .field__error:not(:empty)");
      if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
 
    // Build clean payload with RESOLVED team names (not "home"/"away")
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
 
    // Loading state
    setButtonLoading(btn);
    msg.innerText = "";
    msg.className = "form-msg";
 
    try {
      const res    = await fetch(`${API}/submit`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      });
 
      const result = await res.json();
 
      if (res.ok) {
        // Save prediction record for this match
        localStorage.setItem(storageKey, "true");
        showOnly("alreadySubmitted");
        window.scrollTo({ top: 0, behavior: "smooth" });
 
      } else if (res.status === 409) {
        msg.innerText = "⚠️ This email has already been used for this match.";
        msg.className = "form-msg error";
        // Mark locally so browser doesn't ask again
        localStorage.setItem(storageKey, "true");
        resetButton(btn);
 
      } else if (res.status === 403) {
        msg.innerText = "⛔ " + result.error;
        msg.className = "form-msg error";
        showOnly("closedMsg");
 
      } else {
        msg.innerText = "❌ " + (result.error || "Something went wrong. Please try again.");
        msg.className = "form-msg error";
        resetButton(btn);
      }
 
    } catch {
      msg.innerText = "❌ Could not reach the server. Check your connection.";
      msg.className = "form-msg error";
      resetButton(btn);
    }
  });