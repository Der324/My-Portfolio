// ════════════════════════════════════════
//  MATCH ID FROM URL
// ════════════════════════════════════════
const params  = new URLSearchParams(window.location.search);
const matchId = params.get("match");
 
// ── If no match ID in URL, show error ──
if (!matchId) {
  document.getElementById("predictionForm").classList.add("hidden");
  document.getElementById("noMatchMsg").classList.remove("hidden");
}
 
// ── Check if user already submitted FOR THIS SPECIFIC MATCH ──
const storageKey = `predicted_${matchId}`;
if (localStorage.getItem(storageKey)) {
  document.getElementById("predictionForm").classList.add("hidden");
  document.getElementById("alreadySubmitted").classList.remove("hidden");
}
 
// ════════════════════════════════════════
//  CHECK SERVER MATCH STATUS
// ════════════════════════════════════════
async function checkMatchStatus() {
  if (!matchId) return;
 
  try {
    const res  = await fetch(`https://my-portfolio-production-9dd4.up.railway.app/status?matchId=${matchId}`);
    const data = await res.json();
 
    if (data.label) {
      document.getElementById("matchLabel").innerText = data.label;
    }
 
    if (!data.open) {
      document.getElementById("predictionForm").classList.add("hidden");
      document.getElementById("closedMsg").classList.remove("hidden");
    } else {
      startCountdown(new Date(data.kickoff));
    }
  } catch (err) {
    console.warn("Could not reach server to check status.");
  }
}
 
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
      document.getElementById("predictionForm").classList.add("hidden");
      document.getElementById("closedMsg").classList.remove("hidden");
      return;
    }
 
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.innerText = `⏱ Closes in ${h}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
    setTimeout(update, 1000);
  }
  update();
}
 
checkMatchStatus();
 
// ════════════════════════════════════════
//  NUMBER STEPPER BUTTONS (+/-)
// ════════════════════════════════════════
document.querySelectorAll(".num-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const input  = document.getElementById(btn.dataset.target);
    const action = btn.dataset.action;
    let val = parseInt(input.value) || 0;
 
    if (action === "inc" && val < 20) val++;
    if (action === "dec" && val > 0)  val--;
 
    input.value = val;
    input.dispatchEvent(new Event("input"));
  });
});
 
// ════════════════════════════════════════
//  LIVE TEAM NAME LABELS
// ════════════════════════════════════════
document.getElementById("teamA").addEventListener("input", function () {
  const name = this.value.trim() || "Home Team";
  document.getElementById("fhHomeLabel").innerText     = name;
  document.getElementById("shHomeLabel").innerText     = name;
  document.getElementById("winnerHomeLabel").innerText = name;
});
 
document.getElementById("teamB").addEventListener("input", function () {
  const name = this.value.trim() || "Away Team";
  document.getElementById("fhAwayLabel").innerText     = name;
  document.getElementById("shAwayLabel").innerText     = name;
  document.getElementById("winnerAwayLabel").innerText = name;
});
 
// ════════════════════════════════════════
//  VALIDATION HELPERS
// ════════════════════════════════════════
function showError(fieldId, message) {
  const input = document.getElementById(fieldId);
  const error = document.getElementById(`${fieldId}-error`);
  if (input)  input.classList.add("is-error");
  if (error)  error.innerText = message;
}
 
function clearError(fieldId) {
  const input = document.getElementById(fieldId);
  const error = document.getElementById(`${fieldId}-error`);
  if (input)  input.classList.remove("is-error");
  if (error)  error.innerText = "";
}
 
function clearAllErrors() {
  ["name","email","phone","teamA","teamB","fhGoals","shGoals"].forEach(clearError);
  ["fhLeader-error","shLeader-error","winner-error"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = "";
  });
}
 
// ── Clear error on input ──
["name","email","phone","teamA","teamB","fhGoals","shGoals"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", () => clearError(id));
});
 
function validateForm(data) {
  let valid = true;
  clearAllErrors();
 
  if (!data.name.trim()) {
    showError("name", "Please enter your full name.");
    valid = false;
  }
 
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!data.email.trim()) {
    showError("email", "Please enter your email address.");
    valid = false;
  } else if (!emailRegex.test(data.email)) {
    showError("email", "Please enter a valid email address.");
    valid = false;
  }
 
  if (!data.phone.trim()) {
    showError("phone", "Please enter your phone number.");
    valid = false;
  }
 
  if (!data.teamA.trim()) {
    showError("teamA", "Please enter the home team name.");
    valid = false;
  }
 
  if (!data.teamB.trim()) {
    showError("teamB", "Please enter the away team name.");
    valid = false;
  }
 
  if (!data.fhLeaderRaw) {
    document.getElementById("fhLeader-error").innerText = "Please select who will be leading at half time.";
    valid = false;
  }
 
  const fhGoals = parseInt(data.fhGoals);
  if (isNaN(fhGoals) || fhGoals < 0 || fhGoals > 20) {
    showError("fhGoals", "Enter a valid number of goals (0–20).");
    valid = false;
  }
 
  if (!data.shLeaderRaw) {
    document.getElementById("shLeader-error").innerText = "Please select who will be leading at full time.";
    valid = false;
  }
 
  const shGoals = parseInt(data.shGoals);
  if (isNaN(shGoals) || shGoals < 0 || shGoals > 20) {
    showError("shGoals", "Enter a valid number of goals (0–20).");
    valid = false;
  }
 
  if (!data.winnerRaw) {
    document.getElementById("winner-error").innerText = "Please select the match winner.";
    valid = false;
  }
 
  return valid;
}
 
// ════════════════════════════════════════
//  RESOLVE RADIO VALUE → TEAM NAME
// ════════════════════════════════════════
function resolveTeam(value, teamA, teamB) {
  if (value === "home") return teamA;
  if (value === "away") return teamB;
  return "Draw";
}
 
// ════════════════════════════════════════
//  FORM SUBMISSION
// ════════════════════════════════════════
document.getElementById("predictionForm").addEventListener("submit", async function (e) {
  e.preventDefault();
 
  const btn = document.getElementById("submitBtn");
  const msg = document.getElementById("msg");
 
  const teamA = document.getElementById("teamA").value.trim();
  const teamB = document.getElementById("teamB").value.trim();
 
  const fhLeaderRaw = document.querySelector('input[name="fhLeader"]:checked')?.value;
  const shLeaderRaw = document.querySelector('input[name="shLeader"]:checked')?.value;
  const winnerRaw   = document.querySelector('input[name="winner"]:checked')?.value;
 
  const rawData = {
    name:        document.getElementById("name").value,
    email:       document.getElementById("email").value,
    phone:       document.getElementById("phone").value,
    teamA,
    teamB,
    fhLeaderRaw,
    fhGoals:     document.getElementById("fhGoals").value,
    shLeaderRaw,
    shGoals:     document.getElementById("shGoals").value,
    winnerRaw,
  };
 
  // ── Validate first ──
  if (!validateForm(rawData)) {
    // Scroll to first error
    const firstError = document.querySelector(".is-error, .field__error:not(:empty)");
    if (firstError) firstError.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
 
  // ── Build clean payload ──
  const data = {
    matchId,
    name:     rawData.name.trim(),
    email:    rawData.email.trim(),
    phone:    rawData.phone.trim(),
    teamA,
    teamB,
    fhLeader: resolveTeam(fhLeaderRaw, teamA, teamB),
    fhGoals:  rawData.fhGoals,
    shLeader: resolveTeam(shLeaderRaw, teamA, teamB),
    shGoals:  rawData.shGoals,
    winner:   resolveTeam(winnerRaw, teamA, teamB),
  };
 
  // ── Loading state ──
  btn.disabled = true;
  btn.querySelector(".submit-btn__text").innerText = "Submitting…";
  btn.querySelector(".submit-btn__icon").innerText = "⏳";
  msg.innerText = "";
  msg.className = "form-msg";
 
  try {
    const res    = await fetch("https://my-portfolio-production-9dd4.up.railway.app/submit", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(data),
    });
 
    const result = await res.json();
 
    if (res.ok) {
      localStorage.setItem(storageKey, "true");
      document.getElementById("predictionForm").classList.add("hidden");
      document.getElementById("alreadySubmitted").classList.remove("hidden");
      window.scrollTo({ top: 0, behavior: "smooth" });
 
    } else if (res.status === 409) {
      msg.innerText = "⚠️ This email has already submitted a prediction for this match.";
      msg.className = "form-msg error";
      localStorage.setItem(storageKey, "true");
      btn.disabled = false;
      btn.querySelector(".submit-btn__text").innerText = "Submit My Prediction";
      btn.querySelector(".submit-btn__icon").innerText = "→";
 
    } else if (res.status === 403) {
      msg.innerText = "⛔ " + result.error;
      msg.className = "form-msg error";
      document.getElementById("predictionForm").classList.add("hidden");
      document.getElementById("closedMsg").classList.remove("hidden");
 
    } else {
      msg.innerText = "❌ " + (result.error || "Something went wrong. Please try again.");
      msg.className = "form-msg error";
      btn.disabled  = false;
      btn.querySelector(".submit-btn__text").innerText = "Submit My Prediction";
      btn.querySelector(".submit-btn__icon").innerText = "→";
    }
 
  } catch (err) {
    msg.innerText = "❌ Could not reach the server. Please check your connection.";
    msg.className = "form-msg error";
    btn.disabled  = false;
    btn.querySelector(".submit-btn__text").innerText = "Submit My Prediction";
    btn.querySelector(".submit-btn__icon").innerText = "→";
  }
});