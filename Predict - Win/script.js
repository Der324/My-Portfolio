// ════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════
const API = "https://my-portfolio-production-9dd4.up.railway.app";

let matchId = null;
let storageKey = null;

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
// ════════════════════════════════════════
async function getActiveMatch() {
  try {
    const res = await fetch(`${API}/matches`);
    const matches = await res.json();

    const now = new Date();
    let activeMatches = [];

    for (const id in matches) {
      const kickoff = new Date(matches[id].kickoff);
      const end = new Date(kickoff.getTime() + 2 * 60 * 60 * 1000);

      if (now < end) {
        activeMatches.push({
          id,
          ...matches[id],
          kickoff
        });
      }
    }

    if (activeMatches.length === 0) return null;

    // sort by nearest kickoff
    activeMatches.sort((a, b) => a.kickoff - b.kickoff);

    const selected = activeMatches[0];

    matchId = selected.id;
    storageKey = `predicted_${matchId}`;

    return selected;

  } catch (err) {
    console.error("Failed to fetch matches", err);
    return null;
  }
}

// ════════════════════════════════════════
//  INIT APP (USES BACKEND STATUS)
// ════════════════════════════════════════
async function init() {
  const match = await getActiveMatch();

  if (!match) {
    showOnly("matchEndedMsg");
    return;
  }

  document.getElementById("matchLabel").innerText = match.label;

  const kickoff = new Date(match.kickoff);

  // 🔥 GET REAL STATUS FROM BACKEND
  try {
    const res = await fetch(`${API}/status?matchId=${matchId}`);
    const status = await res.json();

    if (status.ended) {
      showOnly("matchEndedMsg");
      return;
    }

    if (!status.open) {
      showOnly("closedMsg");
      startCountdown(kickoff);
      return;
    }

    // check local submission
    if (localStorage.getItem(storageKey)) {
      showOnly("alreadySubmitted");
    } else {
      showOnly("predictionForm");
    }

    startCountdown(kickoff);

  } catch (err) {
    console.error("Status check failed", err);
    showOnly("matchEndedMsg");
  }
}

init();

// ════════════════════════════════════════
//  COUNTDOWN (2 PHASES)
// ════════════════════════════════════════
function startCountdown(kickoff) {
  const el = document.getElementById("countdown");

  function update() {
    const now = new Date();
    const matchEnd = new Date(kickoff.getTime() + 2 * 60 * 60 * 1000);

    if (now < kickoff) {
      const diff = kickoff - now;

      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);

      el.innerText =
        `⏱ Match starts in ${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;

    } else if (now < matchEnd) {
      const diff = matchEnd - now;

      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);

      el.innerText =
        `⏳ Next prediction opens in ${m}m ${String(s).padStart(2, "0")}s`;

    } else {
      el.innerText = "🏁 Match ended";
      showOnly("matchEndedMsg");
      return;
    }

    setTimeout(update, 1000);
  }

  update();
}

// ════════════════════════════════════════
//  NUMBER STEPPER
// ════════════════════════════════════════
document.querySelectorAll(".num-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;

    let val = parseInt(input.value) || 0;

    if (btn.dataset.action === "inc" && val < 20) val++;
    if (btn.dataset.action === "dec" && val > 0) val--;

    input.value = val;
    input.dispatchEvent(new Event("input"));
  });
});

// ════════════════════════════════════════
//  LIVE TEAM LABELS
// ════════════════════════════════════════
document.getElementById("teamA").addEventListener("input", function () {
  const name = this.value.trim() || "Home Team";
  document.getElementById("fhHomeLabel").innerText = name;
  document.getElementById("shHomeLabel").innerText = name;
  document.getElementById("winnerHomeLabel").innerText = name;
});

document.getElementById("teamB").addEventListener("input", function () {
  const name = this.value.trim() || "Away Team";
  document.getElementById("fhAwayLabel").innerText = name;
  document.getElementById("shAwayLabel").innerText = name;
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
//  VALIDATION (UNCHANGED)
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

  if (!d.name.trim()) { showError("name", "Enter your name"); valid = false; }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(d.email)) {
    showError("email", "Invalid email");
    valid = false;
  }

  if (!d.phone.trim()) { showError("phone", "Enter phone"); valid = false; }
  if (!d.teamA.trim()) { showError("teamA", "Enter home team"); valid = false; }
  if (!d.teamB.trim()) { showError("teamB", "Enter away team"); valid = false; }

  if (!d.fhLeaderRaw) { document.getElementById("fhLeader-error").innerText = "Required"; valid = false; }
  if (!d.shLeaderRaw) { document.getElementById("shLeader-error").innerText = "Required"; valid = false; }
  if (!d.winnerRaw)   { document.getElementById("winner-error").innerText = "Required"; valid = false; }

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
      name: document.getElementById("name").value,
      email: document.getElementById("email").value,
      phone: document.getElementById("phone").value,
      teamA,
      teamB,
      fhLeaderRaw,
      shLeaderRaw,
      winnerRaw,
      fhGoals: document.getElementById("fhGoals").value,
      shGoals: document.getElementById("shGoals").value,
    };

    if (!validateForm(raw)) return;

    const payload = {
      matchId,
      name: raw.name.trim(),
      email: raw.email.trim(),
      phone: raw.phone.trim(),
      teamA,
      teamB,
      fhLeader: resolveTeam(fhLeaderRaw, teamA, teamB),
      fhGoals: raw.fhGoals,
      shLeader: resolveTeam(shLeaderRaw, teamA, teamB),
      shGoals: raw.shGoals,
      winner: resolveTeam(winnerRaw, teamA, teamB),
    };

    btn.disabled = true;

    try {
      const res = await fetch(`${API}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        localStorage.setItem(storageKey, "true");
        showOnly("alreadySubmitted");
      } else {
        msg.innerText = "Submission failed";
      }

    } catch {
      msg.innerText = "Network error";
    }
  });