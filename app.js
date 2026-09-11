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

function statusBadge(player) {
  const status = String(player.injury_status || "").toUpperCase();
  if (!status && player.slot !== "IR") return "";
  const labels = { QUESTIONABLE: "Q", DOUBTFUL: "D", OUT: "OUT", PUP: "PUP", IR: "IR", SUSPENDED: "SUSP", NFI: "NFI" };
  const label = labels[status] || (player.slot === "IR" ? "IR" : status);
  const tone = availability(player) === "uncertain" ? "uncertain" : "unavailable";
  return `<span class="photo-status ${tone}" title="${player.injury_status || "Injured Reserve"}">${label}</span>`;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("de-AT", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(new Date(value));
}

function formatPoints(value, fallback = "–") {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? Number(value).toFixed(2)
    : fallback;
}

function formatPercent(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? `${Number(value).toFixed(1)}%`
    : "–";
}

function actualPointsLabel(player) {
  if (player.actual_points === null || player.actual_points === undefined) return "–";
  if (Number(player.actual_points) !== 0) return formatPoints(player.actual_points);
  if (player.game_start && new Date(player.game_start) > new Date()) return "–";
  if (!player.game_start && player.game_date && new Date(`${player.game_date}T23:59:59`) > new Date()) return "–";
  return "0.00";
}

function performanceIndicator(player) {
  const projected = Number(player.projected_points);
  const actual = Number(player.actual_points);
  const hasValues = Number.isFinite(projected) && player.actual_points !== null && player.actual_points !== undefined;
  const hasStarted = Number(actual) !== 0 || (player.game_start && new Date(player.game_start) <= new Date());
  if (!hasValues || !hasStarted || availability(player) === "unavailable") {
    return `<div class="performance neutral" aria-label="Performance noch offen">
      <svg viewBox="0 0 72 30" aria-hidden="true"><path d="M4 18 L20 18 L36 18 L52 18 L68 18" /></svg>
      <strong>Offen</strong>
    </div>`;
  }
  const difference = actual - projected;
  const direction = difference >= 0 ? "up" : "down";
  const sign = difference >= 0 ? "+" : "";
  const path = direction === "up" ? "M4 24 L20 19 L34 21 L50 11 L68 5" : "M4 6 L20 11 L34 9 L50 20 L68 25";
  const label = direction === "up" ? "Prognose übertroffen" : "Unter Prognose";
  return `<div class="performance ${direction}" aria-label="${label}: ${sign}${formatPoints(difference)} Punkte">
    <svg viewBox="0 0 72 30" aria-hidden="true"><path d="${path}"/><polyline points="${direction === "up" ? "59,5 68,5 68,14" : "59,25 68,25 68,16"}"/></svg>
    <strong>${sign}${formatPoints(difference)}</strong><small>${label}</small>
  </div>`;
}

function matchupLabel(player) {
  if (!player.week_opponent) return "Termin offen";
  const opponent = `vs ${player.week_opponent}`;
  if (player.game_start) {
    const kickoff = new Intl.DateTimeFormat("de-AT", {
      timeZone: "Europe/Vienna",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(player.game_start));
    return `${opponent} · ${kickoff} Uhr`;
  }
  if (!player.game_date) return opponent;
  const date = new Intl.DateTimeFormat("de-AT", { day: "2-digit", month: "2-digit" }).format(new Date(`${player.game_date}T12:00:00`));
  return `${opponent} · ${date} · Uhrzeit offen`;
}

function initials(name, fallback) {
  const value = String(name || "").trim();
  if (!value) return fallback;
  return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function avatarUrl(avatar) {
  if (!avatar) return null;
  if (/^https?:\/\//i.test(avatar)) return avatar;
  return `https://sleepercdn.com/avatars/thumbs/${encodeURIComponent(avatar)}`;
}

function renderTeamBadge(selector, identity, fallback) {
  const element = $(selector);
  const src = avatarUrl(identity?.avatar);
  const label = identity?.team_name || fallback;
  element.innerHTML = src
    ? `<img src="${src}" alt="${label} Wappen" onerror="this.remove();this.parentElement.querySelector('span').hidden=false"><span hidden>${initials(label, fallback)}</span>`
    : `<span>${initials(label, fallback)}</span>`;
}

function renderBrand(identity, fallback) {
  const name = identity?.team_name || fallback || "Fantasy Team";
  const mark = $("#brand-mark");
  const src = avatarUrl(identity?.avatar);
  $("#brand-team-name").textContent = name;
  $("#team-brand").setAttribute("aria-label", `${name} Fantasy Manager Startseite`);
  mark.innerHTML = src
    ? `<img src="${src}" alt="${name} Wappen" onerror="this.remove();this.parentElement.querySelector('span').hidden=false"><span hidden>${initials(name, "FT")}</span>`
    : `<span>${initials(name, "FT")}</span>`;
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
  $("#my-matchup-name").textContent = data.my_team?.team_name || data.my_team_name || "Vienna Steel";
  $("#opponent-matchup-name").textContent = data.opponent_team?.team_name || "Gegner";
  renderTeamBadge("#my-team-badge", data.my_team, "VS");
  renderTeamBadge("#opponent-team-badge", data.opponent_team, "OPP");
  renderBrand(data.my_team, data.my_team_name);
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
  flags.push(`<li><span>Gegner</span><strong>${matchupLabel(player)}</strong></li>`);
  flags.push(`<li><span>Prognose</span><strong>${availability(player) === "unavailable" ? "0.00" : formatPoints(player.projected_points)} Pkt.</strong></li>`);
  flags.push(`<li><span>Ist-Punkte</span><strong>${actualPointsLabel(player)} Pkt.</strong></li>`);
  flags.push(`<li><span>Trending Adds</span><strong>+${Number(player.trending_adds_24h || 0).toLocaleString("de-AT")}</strong></li>`);
  return `<article class="compare-player panel">
    <span class="compare-label">${label}</span>
    <div class="compare-player-head">
      <img src="${playerImage(player)}" alt="" onerror="this.src='./favicon.svg'" />
      ${statusBadge(player)}
      <div><span class="position-inline">${player.position}</span><h3>${player.name}</h3><p>${player.team || "FA"}</p></div>
    </div>
    <ul>${flags.join("")}</ul>
  </article>`;
}

function availability(player) {
  const status = String(player.injury_status || "").toUpperCase();
  const unavailable = new Set(["OUT", "PUP", "IR", "SUSPENDED", "NFI"]);
  const uncertain = new Set(["DOUBTFUL", "QUESTIONABLE"]);

  if (player.slot === "IR" || unavailable.has(status)) return "unavailable";
  if (uncertain.has(status)) return "uncertain";
  return "available";
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
  const aAvailability = availability(a);
  const bAvailability = availability(b);
  if (a.player_id === b.player_id) {
    title.textContent = "Bitte zwei unterschiedliche Spieler wählen";
    text.textContent = "Für einen Vergleich müssen Spieler A und Spieler B verschieden sein.";
  } else if (aAvailability === "unavailable" && bAvailability === "unavailable") {
    title.textContent = "Keiner der beiden Spieler ist aktuell einsatzfähig";
    text.textContent = `${a.name} (${a.injury_status || "IR"}) und ${b.name} (${b.injury_status || "IR"}) dürfen aktuell nicht als Start-Option gewertet werden.`;
  } else if (aAvailability === "unavailable") {
    title.textContent = `${b.name} hat aktuell den sichereren Status`;
    text.textContent = `${a.name} ist mit „${a.injury_status || "IR"}“ nicht einsatzfähig und darf aktuell keine Start-Empfehlung erhalten.`;
  } else if (bAvailability === "unavailable") {
    title.textContent = `${a.name} hat aktuell den sichereren Status`;
    text.textContent = `${b.name} ist mit „${b.injury_status || "IR"}“ nicht einsatzfähig und darf aktuell keine Start-Empfehlung erhalten.`;
  } else if (aAvailability === "uncertain" || bAvailability === "uncertain") {
    const uncertainPlayers = [a, b].filter((player) => availability(player) === "uncertain");
    title.textContent = "Mindestens ein Status ist noch nicht sicher";
    text.textContent = `${uncertainPlayers.map((player) => `${player.name} (${player.injury_status})`).join(" und ")} vor dem Start noch einmal prüfen.`;
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
  const teamById = new Map(state.league.team.map((player) => [String(player.player_id), player]));
  const starterIds = (state.league.matchup?.starters || []).map(String);
  const starterPositions = state.league.league.roster_positions
    .filter((position) => position !== "BN")
    .slice(0, starterIds.length);
  const starterLabels = starterPositions.map((position) =>
    ["FLEX", "WRRB_FLEX"].includes(position) ? "RB/WR" : position
  );
  const starters = starterIds.map((id, index) => ({
    ...teamById.get(id),
    displaySlot: starterLabels[index] || teamById.get(id)?.position || "–"
  })).filter((player) => player.player_id);
  const reserves = state.league.team.filter((player) => player.slot === "BENCH").map((player) => ({ ...player, displaySlot: "RES" }));
  const injuredReserve = state.league.team.filter((player) => player.slot === "IR").map((player) => ({ ...player, displaySlot: "IR" }));
  const groups = [
    { slot: "STARTER", label: "Aufstellung", players: starters },
    { slot: "BENCH", label: "Reserve", players: reserves },
    { slot: "IR", label: "Injured Reserve", players: injuredReserve }
  ].filter((group) => (state.slot === "ALL" || state.slot === group.slot) && group.players.length);

  $("#roster").innerHTML = groups.map((group) => `
    <div class="roster-group-title"><span>${group.label}</span><small>${group.players.length} Spieler</small></div>
    ${group.players.map((player) => `
    <article class="player-card availability-${availability(player)}">
      <div class="player-photo-wrap">
        <img class="player-photo" src="${playerImage(player)}" alt="" loading="lazy" onerror="this.src='./favicon.svg'" />
        ${statusBadge(player)}
        <span class="position position-${player.position?.toLowerCase()}">${player.position || "–"}</span>
      </div>
      <div class="lineup-slot">${player.displaySlot}</div>
      <div class="player-info">
        <div class="player-topline"><span>${player.team || "FA"} · ${player.position || "–"}</span></div>
        <h3>${player.name}</h3>
        <p>${player.depth_chart_position || "Depth Chart offen"}</p>
        <div class="roster-meta">
          <span><small>Rostered</small><strong>${formatPercent(player.rostered_percent)}</strong></span>
          <span><small>Start</small><strong>${formatPercent(player.start_percent)}</strong></span>
        </div>
      </div>
      <div class="player-week">
        <div><span>Matchup</span><strong>${matchupLabel(player)}</strong></div>
        <div><span>Prognose</span><strong class="projection">${availability(player) === "unavailable" ? "0.00" : formatPoints(player.projected_points)}</strong><small>Pkt.</small></div>
        <div><span>Erreicht</span><strong>${actualPointsLabel(player)}</strong><small>Pkt.</small></div>
        ${performanceIndicator(player)}
      </div>
    </article>
    `).join("")}
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
