// Get match ID from URL: e.g index.html?match=match-001
const params = new URLSearchParams(window.location.search);
const matchId = params.get("match");

// If no match ID in URL, show error
if (!matchId) {
  document.getElementById("predictionForm").classList.add("hidden");
  document.getElementById("noMatchMsg").classList.remove("hidden");
}

//Check if user already submitted For This Specific Match
const storageKey = `predicted_${matchId}`;
if (localStorage.getItem(storageKey)) {
  document.getElementById("predictionForm").classList.add("hidden");
  document.getElementById("alreadySubmitted").classList.remove("hidden");
}

// Check server if prediction sre still open
async function checkMatchStatus() {
  if (!matchId) return;

  try {
    const res = await fetch(`http://localhost:3000/status?matchId=${matchId}`);
    const data = await res.json();

    // Update match label in header
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

// Countdown time
function startCountdown(kickoff) {
  const el= document.getElementById("countdown");
  if (!el) return;

  function update() {
    const diff = kickoff - new Date();

    if (diff <= 0) {
      el.innerText = "⛔ Predictions are now closed.";
      document.getElementById("predictionForm").classList.add("hidden");
      document.getElementById("closedMsg").classList.remove("hidden");
      return;
    }

    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.innerText = `⏱ Predictions close in: ${h}h ${m}m ${s}s`;
    setTimeout(update, 1000);
  }
  update();
}

checkMatchStatus();

// Dynamically update radio label as user types team names
document.getElementById("teamA").addEventListener("input", function () {
  const name = this.value || "Home Team";
  document.getElementById("fhHomeLabel").innerText    = name;
  document.getElementById("shHomeLabel").innerText    = name;
  document.getElementById("winnerHomeLabel").innerText = name;
});

document.getElementById("teamB").addEventListener("input", function () {
  const name = this.value || "Away Team";
  document.getElementById("fhAwayLabel").innerText    = name;
  document.getElementById("shAwayLabel").innerText    = name;
  document.getElementById("winnerAwayLabel").innerText = name;
});

// Resolve radio value to actual tam name
function resolveTeam(value, teamA, teamB) {
  if (value === "home") return teamA;
  if (value === "away") return teamB;
  return "Draw";
}

// Form submission
document.getElementById("predictionForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  const btn = document.getElementById("submitBtn");
  const msg = document.getElementById("msg");

  const teamA = document.getElementById("teamA").value.trim();
  const teamB = document.getElementById("teamB").value.trim();

  const fhLeaderRaw = document.querySelector('input[name="fhLeader"]:checked')?.value;
  const shLeaderRaw = document.querySelector('input[name="shLeader"]:checked')?.value;
  const winnerRaw   = document.querySelector('input[name="winner"]:checked')?.value;

  // Client-side validation
  if (!fhLeaderRaw || !shLeaderRaw || !winnerRaw) {
    msg.innerText = "❌ Please select all prediction options.";
    msg.className = "error";
    return;
  }

  const data = {
    matchId,
    name:     document.getElementById("name").value.trim(),
    email:    document.getElementById("email").value.trim(),
    phone:    document.getElementById("phone").value.trim(),
    teamA,
    teamB,
    fhLeader: resolveTeam(fhLeaderRaw, teamA, teamB),
    fhGoals:  document.getElementById("fhGoals").value,
    shLeader: resolveTeam(shLeaderRaw, teamA, teamB),
    shGoals:  document.getElementById("shGoals").value,
    winner:   resolveTeam(winnerRaw, teamA, teamB),
  };

  btn.disabled    = true;
  btn.innerText   = "Submitting...";
  msg.innerText   = "";
  msg.className   = "";

  try {
    const res    = await fetch("http://localhost:3000/submit", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(data),
    });

    const result = await res.json();

    if (res.ok) {
      // Save per match, not globally
      localStorage.setItem(storageKey, "true");
      document.getElementById("predictionForm").classList.add("hidden");
      document.getElementById("alreadySubmitted").classList.remove("hidden");

    } else if (res.status === 409) {
      msg.innerText = "❌ You have already predicted for this match.";
      msg.className = "error";
      localStorage.setItem(storageKey, "true");
      btn.disabled = false;
      btn.innerText = "submit Prediction";

    }else if (res.status === 403) {
      msg.innerText = "⛔ " + result.error;
      msg.className = "error"
      document.getElementById("predictionForm").classList.add("hidden");
      document.getElementById("closedMsg").classList.remove("hidden");

    } else {
      msg.innerText = "❌ " + (result.error || "Submission failed. Please try again.");
      msg.className = "error";
      btn.disabled  = false;
      btn.innerText = "Submit Prediction";
    }

  } catch (err) {
    msg.innerText = "❌ Could not reach server. Is it running?";
    msg.className = "error";
    btn.disabled  = false;
    btn.innerText = "Submit Prediction";
  }
});