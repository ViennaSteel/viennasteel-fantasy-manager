const state = { context: null, league: null, slot: "ALL", view: "dashboard-view" };

const $ = (selector) => document.querySelector(selector);
const cacheKey = () => `v=${Date.now()}`;

async function loadJson(path) {
  const response = await fetch(`./${path}?${cacheKey()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function playerImage(player) {
  if (player.position === "DEF") {
    return `https://sleepercdn.com/images/team_logos/nfl/${player.team?.toLowerCase()}.png`;
  }
  return `https://sleepercdn.com/content/nfl/players/thumb/${player.player_id}.jpg`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(new Date(value));
}

function renderContext() {
  const picker = $("#league-picker");
  picker.innerHTML = state.context.leagues.map((league) =>
    `<option value="${league.league_id}">${league.name} · ${league.teams} Teams</option>`
  ).join("");
  $("#season").textContent = state.context.season;
  $("#week").textContent = state.context.nfl_week;
}

function renderLeague() {
  const data = state.league;
  $("#league-name").textContent = data.league.name;
  $("#team-name").textContent = data.my_team_name;
  $("#matchup-week").textContent = data.week;
  $("#compare-week").textContent = data.week;
  $("#my-score").textContent = Number(data.matchup?.points || 0).toFixed(2);
  $("#opponent-score").textContent = Number(data.opponent?.points || 0).toFixed(2);
  $("#sync-label").textContent = `Aktuell · ${formatTime(data.updated_at)}`;
  renderAlerts();
  renderRoster();
  renderPlayerOptions();
}

function selectablePlayers() {
  return state.league.team.filter((player) => ["QB", "RB", "WR", "TE"].includes(player.position));
}

function renderPlayerOptions() {
  const players = selectablePlayers();
  const options = players.map((player) => `<option value="${player.player_id}">${player.name} · ${player.position} · ${player.slot === "STARTER" ? "Starter" : player.slot === "BENCH" ? "Bank" : "IR"}</option>`).join("");
  $("#player-a").innerHTML = options;
  $("#player-b").innerHTML = options;

  const firstBench = players.find((player) => player.slot === "BENCH" && ["RB", "WR", "TE"].includes(player.position));
  const samePositionStarter = players.find((player) => player.slot === "STARTER" && player.position === firstBench?.position);
  $("#player-a").value = samePositionStarter?.player_id || players[0]?.player_id || "";
  $("#player-b").value = firstBench?.player_id || players[1]?.player_id || players[0]?.player_id || "";
  renderComparison();
}

function comparisonCard(player, label) {
  const flags = [];
  flags.push(`<li><span>Lineup</span><strong>${player.slot === "STARTER" ? "Starter" : player.slot === "BENCH" ? "Bank" : "IR"}</strong></li>`);
  flags.push(`<li><span>Status</span><strong class="${player.injury_status ? "negative" : "positive"}">${player.injury_status || "Aktiv"}</strong></li>`);
  flags.push(`<li><span>Depth Chart</span><strong>${player.depth_chart_position || "–"}</strong></li>`);
  flags.push(`<li><span>Trending Adds</span><strong>+${Number(player.trending_adds_24h || 0).toLocaleString("de-AT")}</strong></li>`);
  return `<article class="compare-player panel">
    <span class="compare-label">${label}</span>
    <div class="compare-player-head">
      <img src="${playerImage(player)}" alt="" onerror="this.src='./favicon.svg'" />
      <div><span class="position-inline">${player.position}</span><h3>${player.name}</h3><p>${player.team || "FA"}</p></div>
    </div>
    <ul>${flags.join("")}</ul>
  </article>`;
}

function renderComparison() {
  if (!state.league) return;
  const players = selectablePlayers();
  const a = players.find((player) => player.player_id === $("#player-a").value);
  const b = players.find((player) => player.player_id === $("#player-b").value);
  if (!a || !b) return;
  $("#comparison").innerHTML = comparisonCard(a, "Spieler A") + comparisonCard(b, "Spieler B");

  const title = $("#recommendation-title");
  const text = $("#recommendation-text");
  if (a.player_id === b.player_id) {
    title.textContent = "Bitte zwei unterschiedliche Spieler wählen";
    text.textContent = "Für einen Vergleich müssen Spieler A und Spieler B verschieden sein.";
  } else if (a.injury_status && !b.injury_status) {
    title.textContent = `${b.name} hat aktuell den sichereren Status`;
    text.textContent = `${a.name} ist mit „${a.injury_status}“ gemeldet. Eine finale Start/Sit-Empfehlung folgt mit den Wochen-Projektionen.`;
  } else if (b.injury_status && !a.injury_status) {
    title.textContent = `${a.name} hat aktuell den sichereren Status`;
    text.textContent = `${b.name} ist mit „${b.injury_status}“ gemeldet. Eine finale Start/Sit-Empfehlung folgt mit den Wochen-Projektionen.`;
  } else if (a.position !== b.position && ![a.position, b.position].every((position) => ["RB", "WR", "TE"].includes(position))) {
    title.textContent = "Diese Positionen sind nicht austauschbar";
    text.textContent = `${a.position} und ${b.position} konkurrieren in deinem Lineup nicht um denselben Slot.`;
  } else {
    title.textContent = "Beide Spieler sind aktuell einsatzfähig";
    text.textContent = "Für die finale Empfehlung ergänzen wir als Nächstes Gegner, Projektionen, Usage und aktuelle News.";
  }
}

function switchView(viewId) {
  state.view = viewId;
  document.querySelectorAll(".app-view").forEach((view) => { view.hidden = view.id !== viewId; });
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  localStorage.setItem("vienna-steel-view", viewId);
}

function renderAlerts() {
  const injured = state.league.team.filter((player) => player.injury_status);
  const starterInjuries = injured.filter((player) => player.slot === "STARTER");
  const alerts = [];

  if (starterInjuries.length) {
    alerts.push({ tone: "danger", title: `${starterInjuries.length} Starter mit Status`, text: starterInjuries.map((p) => `${p.name} (${p.injury_status})`).join(", ") });
  }
  if (injured.length) {
    alerts.push({ tone: "warning", title: `${injured.length} Verletzungs-Update${injured.length > 1 ? "s" : ""}`, text: injured.map((p) => `${p.name}: ${p.injury_status}`).join(" · ") });
  }
  if (!alerts.length) {
    alerts.push({ tone: "good", title: "Lineup sieht sauber aus", text: "Aktuell ist kein Spieler mit Verletzungsstatus aufgestellt." });
  }

  $("#alerts").innerHTML = alerts.map((alert) => `
    <div class="alert ${alert.tone}"><span class="alert-icon">${alert.tone === "good" ? "✓" : "!"}</span><div><strong>${alert.title}</strong><small>${alert.text}</small></div></div>
  `).join("");
}

function renderRoster() {
  const players = state.league.team.filter((player) => state.slot === "ALL" || player.slot === state.slot);
  const order = { STARTER: 0, BENCH: 1, IR: 2 };
  players.sort((a, b) => order[a.slot] - order[b.slot]);

  $("#roster").innerHTML = players.map((player) => `
    <article class="player-card">
      <div class="player-photo-wrap">
        <img class="player-photo" src="${playerImage(player)}" alt="" loading="lazy" onerror="this.src='./favicon.svg'" />
        <span class="position position-${player.position?.toLowerCase()}">${player.position || "–"}</span>
      </div>
      <div class="player-info">
        <div class="player-topline"><span>${player.slot === "STARTER" ? "Starter" : player.slot === "BENCH" ? "Bank" : "IR"}</span>${player.injury_status ? `<b class="injury">${player.injury_status}</b>` : ""}</div>
        <h3>${player.name}</h3>
        <p>${player.team || "FA"} · ${player.depth_chart_position || player.position || "–"}</p>
        <div class="trend"><span>+${Number(player.trending_adds_24h || 0).toLocaleString("de-AT")}</span> Adds 24h</div>
      </div>
    </article>
  `).join("");
}

async function selectLeague(leagueId) {
  const league = state.context.leagues.find((item) => item.league_id === leagueId);
  if (!league) return;
  $("#loading").hidden = false;
  $("#dashboard").hidden = true;
  state.league = await loadJson(league.league_file);
  localStorage.setItem("vienna-steel-league", leagueId);
  renderLeague();
  $("#loading").hidden = true;
  $("#dashboard").hidden = false;
}

async function init() {
  try {
    $("#error").hidden = true;
    $("#loading").hidden = false;
    state.context = await loadJson("data/context.json");
    renderContext();
    const saved = localStorage.getItem("vienna-steel-league");
    const initial = state.context.leagues.some((league) => league.league_id === saved) ? saved : state.context.leagues[0].league_id;
    $("#league-picker").value = initial;
    await selectLeague(initial);
  } catch (error) {
    console.error(error);
    $("#loading").hidden = true;
    $("#dashboard").hidden = true;
    $("#error").hidden = false;
    $("#sync-label").textContent = "Nicht verbunden";
  }
}

$("#league-picker").addEventListener("change", (event) => selectLeague(event.target.value).catch(init));
$("#retry").addEventListener("click", init);
document.querySelectorAll("[data-slot]").forEach((button) => button.addEventListener("click", () => {
  state.slot = button.dataset.slot;
  document.querySelectorAll("[data-slot]").forEach((item) => item.classList.toggle("active", item === button));
  renderRoster();
}));
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#player-a").addEventListener("change", renderComparison);
$("#player-b").addEventListener("change", renderComparison);

init();
