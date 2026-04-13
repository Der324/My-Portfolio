//  CONFIG
const API = "https://my-portfolio-production-9dd4.up.railway.app";

//  MATCH ID FROM URL
const params  = new URLSearchParams(window.location.search);
const matchId = params.get("match");

// Attach matchId to hidden input
const matchInput = document.getElementById("matchIdInput");
if (matchInput) matchInput.value = matchId;

// If no match ID → block form
if (!matchId) {
  document.getElementById("predictionForm").classList.add("hidden");
  document.getElementById("noMatchMsg").classList.remove("hidden");
}

// Local UX check (NOT security)
const storageKey = `predicted_${matchId}`;
if (localStorage.getItem(storageKey)) {
  document.getElementById("predictionForm").classList.add("hidden");
  document.getElementById("alreadySubmitted").classList.remove("hidden");
}


//  CHECK SERVER MATCH STATUS
async function checkMatchStatus() {
  if (!matchId) return;

  try {
    const res  = await fetch(`${API}/status?matchId=${matchId}`);
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
  } catch {
    console.warn("Could not reach server.");
  }
}

checkMatchStatus();

//  COUNTDOWN TIMER
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


//  NUMBER BUTTONS (+ / -)
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

//  LIVE TEAM LABELS
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


//  VALIDATION
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
  ["name","email","phone","teamA","teamB","fhGoals","shGoals"].forEach(clearError);
  ["fhLeader-error","shLeader-error","winner-error"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerText = "";
  });
}

function validateForm(data) {
  let valid = true;
  clearAllErrors();

  if (!data.name) { showError("name","Enter your name"); valid = false; }
  if (!data.email) { showError("email","Enter email"); valid = false; }
  if (!data.phone) { showError("phone","Enter phone"); valid = false; }
  if (!data.teamA) { showError("teamA","Enter team"); valid = false; }
  if (!data.teamB) { showError("teamB","Enter team"); valid = false; }
  if (!data.fhLeader) { document.getElementById("fhLeader-error").innerText = "Select option"; valid = false; }
  if (!data.shLeader) { document.getElementById("shLeader-error").innerText = "Select option"; valid = false; }
  if (!data.winner) { document.getElementById("winner-error").innerText = "Select option"; valid = false; }

  return valid;
}

//  SUBMISSION (UPDATED)
document.getElementById("predictionForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const btn = document.getElementById("submitBtn");
  const msg = document.getElementById("msg");

  const payload = {
    matchId,
    name: document.getElementById("name").value.trim(),
    email: document.getElementById("email").value.trim(),
    phone: document.getElementById("phone").value.trim(),
    teamA: document.getElementById("teamA").value.trim(),
    teamB: document.getElementById("teamB").value.trim(),
    fhLeader: document.querySelector('input[name="fhLeader"]:checked')?.value,
    fhGoals: document.getElementById("fhGoals").value,
    shLeader: document.querySelector('input[name="shLeader"]:checked')?.value,
    shGoals: document.getElementById("shGoals").value,
    winner: document.querySelector('input[name="winner"]:checked')?.value,
  };

  if (!validateForm(payload)) return;

  btn.disabled = true;
  btn.innerText = "Submitting...";
  msg.innerText = "";

  try {
    const res = await fetch(`${API}/submit`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (res.ok) {
      localStorage.setItem(storageKey, "true");
      document.getElementById("predictionForm").classList.add("hidden");
      document.getElementById("alreadySubmitted").classList.remove("hidden");
    } else {
      msg.innerText = data.error || "Something went wrong.";
      msg.className = "form-msg error";
      btn.disabled = false;
      btn.innerText = "Submit My Prediction";
    }

  } catch {
    msg.innerText = "Network error. Try again.";
    msg.className = "form-msg error";
    btn.disabled = false;
    btn.innerText = "Submit My Prediction";
  }
});