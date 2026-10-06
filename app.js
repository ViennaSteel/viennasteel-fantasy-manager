import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { browserLocalPersistence, getAuth, onAuthStateChanged, setPersistence, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { doc, getDoc, getFirestore } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCrD67-1PyNha6bpdPfQBgKflR-nM3gp2A",
  authDomain: "viennasteel-fantasy-manager.firebaseapp.com",
  projectId: "viennasteel-fantasy-manager",
  storageBucket: "viennasteel-fantasy-manager.firebasestorage.app",
  messagingSenderId: "647220554071",
  appId: "1:647220554071:web:2f46c93feab1a4199ab612"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getFirestore(firebaseApp);
const state = { context: null, league: null, profile: null, week: null, slot: "ALL", view: "dashboard-view", rankingPosition: "QB", rankingSearch: "", waiverPosition: "QB", waiverSearch: "", waivers: {} };
const splashStartedAt = performance.now();
let authErrorMessage = "";

const $ = (selector) => document.querySelector(selector);

async function loadFantasyDocument(...segments) {
  const snapshot = await getDoc(doc(db, ...segments));
  if (!snapshot.exists()) throw new Error(`Firestore document not found: ${segments.join("/")}`);
  return snapshot.data();
}

function playerImage(player) {
  if (player.position === "DEF") {
    return `https://sleepercdn.com/images/team_logos/nfl/${player.team?.toLowerCase()}.png`;
  }
  return `https://sleepercdn.com/content/nfl/players/thumb/${player.player_id}.jpg`;
}

function isByeWeek(player) {
  const team = String(player.team || "").trim().toUpperCase();
  if (!team || team === "FA") return false;
  return !player.week_opponent && !player.game_start && !player.game_date;
}

function statusBadge(player) {
  const status = String(player.injury_status || "").toUpperCase();
  const byeBadge = isByeWeek(player) ? `<span class="photo-status bye" title="Bye Week">BYE</span>` : "";
  if (!status && player.slot !== "IR") return byeBadge;
  const labels = { QUESTIONABLE: "Q", DOUBTFUL: "D", OUT: "OUT", PUP: "PUP", IR: "IR", SUSPENDED: "SUSP", NFI: "NFI" };
  const label = labels[status] || (player.slot === "IR" ? "IR" : status);
  const tone = availability(player) === "uncertain" ? "uncertain" : "unavailable";
  return `<span class="photo-status ${tone}" title="${player.injury_status || "Injured Reserve"}">${label}</span>${byeBadge}`;
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
      <div class="performance-copy"><strong>Offen</strong><small>Noch kein Ergebnis</small></div>
      <svg viewBox="0 0 88 38" aria-hidden="true"><path class="performance-line" d="M4 22 C25 22 63 22 84 22" /><circle cx="84" cy="22" r="3.5" /></svg>
    </div>`;
  }
  const difference = actual - projected;
  const direction = difference >= 0 ? "up" : "down";
  const sign = difference >= 0 ? "+" : "";
  const path = direction === "up"
    ? "M4 29 C16 27 20 22 31 23 C43 24 48 16 58 15 C69 14 74 8 84 7"
    : "M4 8 C16 10 20 16 31 15 C43 14 48 23 58 24 C69 25 74 30 84 31";
  const area = `${path} L84 36 L4 36 Z`;
  const endpointY = direction === "up" ? 7 : 31;
  const label = direction === "up" ? "Über Prognose" : "Unter Prognose";
  return `<div class="performance ${direction}" aria-label="${label}: ${sign}${formatPoints(difference)} Punkte">
    <div class="performance-copy"><strong>${sign}${formatPoints(difference)}</strong><small>${label}</small></div>
    <svg viewBox="0 0 88 38" aria-hidden="true">
      <path class="performance-area" d="${area}" />
      <path class="performance-line" d="${path}" />
      <circle cx="84" cy="${endpointY}" r="3.5" />
    </svg>
  </div>`;
}

function matchupLabel(player) {
  if (isByeWeek(player)) return "BYE WEEK";
  if (!player.week_opponent) return "Termin offen";
  const opponent = `vs ${player.week_opponent}`;
  if (player.game_start) {
    const kickoff = new Intl.DateTimeFormat("de-AT", {
      timeZone: "Europe/Vienna",
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(player.game_start));
    return `${opponent} · ${kickoff} Uhr`;
  }
  if (!player.game_date) return opponent;
  const date = new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(`${player.game_date}T12:00:00`));
  return `${opponent} · ${date} · Uhrzeit offen`;
}

function matchupDisplay(player) {
  if (isByeWeek(player)) return `<span class="matchup-date bye-label">BYE WEEK</span>`;
  if (!player.week_opponent) return `<span class="matchup-date">Termin offen</span>`;
  const opponent = `vs ${player.week_opponent}`;
  if (player.game_start) {
    const game = new Date(player.game_start);
    const date = new Intl.DateTimeFormat("de-AT", {
      timeZone: "Europe/Vienna", weekday: "short", day: "2-digit", month: "2-digit"
    }).format(game);
    const time = new Intl.DateTimeFormat("de-AT", {
      timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit"
    }).format(game);
    return `<span class="matchup-date">${opponent} · ${date}</span><span class="matchup-time">${time} Uhr</span>`;
  }
  if (!player.game_date) return `<span class="matchup-date">${opponent}</span>`;
  const date = new Intl.DateTimeFormat("de-AT", {
    weekday: "short", day: "2-digit", month: "2-digit"
  }).format(new Date(`${player.game_date}T12:00:00`));
  return `<span class="matchup-date">${opponent} · ${date}</span><span class="matchup-time">Uhrzeit offen</span>`;
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

async function finishSplash() {
  const remaining = Math.max(0, 4000 - (performance.now() - splashStartedAt));
  if (remaining) await new Promise(resolve => setTimeout(resolve, remaining));
  $("#splash-screen").classList.add("is-finished");
  document.body.classList.remove("splash-active");
}

function showLogin(message = "") {
  $("#app-shell").setAttribute("aria-hidden", "true");
  $("#login-screen").hidden = false;
  $("#logout-button").hidden = true;
  $("#login-error").hidden = !message;
  $("#login-error").textContent = message;
}

function showApp() {
  $("#login-screen").hidden = true;
  $("#app-shell").setAttribute("aria-hidden", "false");
  $("#logout-button").hidden = false;
}

function loginErrorMessage(error) {
  const code = String(error?.code || "");
  if (["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found"].includes(code)) return "E-Mail-Adresse oder Passwort ist nicht korrekt.";
  if (code === "auth/too-many-requests") return "Zu viele Anmeldeversuche. Bitte versuche es später erneut.";
  if (code === "auth/user-disabled") return "Dieser Account wurde deaktiviert.";
  return "Die Anmeldung ist gerade nicht möglich. Bitte versuche es erneut.";
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

function standingsLabel(identity) {
  if (!identity) return "Bilanz offen · Platz –";
  const ties = Number(identity.ties || 0);
  const record = `${Number(identity.wins || 0)}–${Number(identity.losses || 0)}${ties ? `–${ties}` : ""}`;
  return `${record} · Platz ${identity.rank || "–"}`;
}

function renderWinChance(data) {
  const probability = Number(data.win_probability?.my_team);
  const validProbability = Number.isFinite(probability);
  const projectedFinal = data.win_probability?.projected_final;
  const mine = validProbability ? Math.round(probability * 100) : 50;
  const opponent = 100 - mine;
  $("#my-matchup-projection").textContent = `(Proj. ${formatPoints(projectedFinal?.my_team)})`;
  $("#opponent-matchup-projection").textContent = `(Proj. ${formatPoints(projectedFinal?.opponent)})`;
  $("#my-win-chance").textContent = mine;
  $("#opponent-win-chance").textContent = opponent;
  $("#win-chance-fill").style.width = `${mine}%`;
  $("#win-chance").classList.toggle("is-leading", mine > opponent);
  $("#win-chance").classList.toggle("is-trailing", mine < opponent);
  $("#win-chance-note").textContent = validProbability
    ? (data.win_probability.final
      ? "Endergebnis"
      : "Schätzung aus aktuellem Stand und verbleibenden Prognosen")
    : "Noch nicht genügend Daten für eine belastbare Schätzung";
}

function activeWeekData() {
  return state.league?.weeks?.[String(state.week)] || state.league;
}

function renderWeekPicker() {
  const weeks = state.league.available_weeks || [Number(state.league.week)];
  const picker = $("#matchup-week-picker");
  picker.innerHTML = weeks.map(week => `<option value="${week}">Woche ${week}</option>`).join("");
  picker.value = String(state.week);
  $("#previous-week").disabled = state.week <= Math.min(...weeks);
  $("#next-week").disabled = state.week >= Math.max(...weeks);
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
  const root = state.league;
  const data = activeWeekData();
  $("#league-name").textContent = root.league.name;
  $("#team-name").textContent = root.my_team_name;
  $("#week").textContent = state.week;
  $("#matchup-week").textContent = state.week;
  $("#compare-week").textContent = state.week;
  $("#ranking-week").textContent = root.ranking_week || state.context.nfl_week;
  $("#my-score").textContent = Number(data.matchup?.points || 0).toFixed(2);
  $("#opponent-score").textContent = Number(data.opponent?.points || 0).toFixed(2);
  $("#my-matchup-name").textContent = data.my_team?.team_name || root.my_team_name || "Vienna Steel";
  $("#opponent-matchup-name").textContent = data.opponent_team?.team_name || "Gegner";
  $("#my-matchup-meta").textContent = standingsLabel(data.my_team);
  $("#opponent-matchup-meta").textContent = standingsLabel(data.opponent_team);
  renderTeamBadge("#my-team-badge", data.my_team, "VS");
  renderTeamBadge("#opponent-team-badge", data.opponent_team, "OPP");
  renderWinChance(data);
  renderBrand(data.my_team, root.my_team_name);
  $("#sync-label").textContent = `Aktuell · ${formatTime(root.updated_at)}`;
  $("#matchup-status").textContent = state.week < Number(state.context.nfl_week) ? "Final" : state.week === Number(state.context.nfl_week) ? "Live" : "Vorschau";
  renderWeekPicker();
  renderAlerts();
  renderRoster();
  renderPlayerOptions();
  renderRankings();
}

function selectablePlayers() {
  return activeWeekData().team.filter((player) => ["QB", "RB", "WR", "TE"].includes(player.position));
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
  flags.push(`<li><span>Status</span><strong class="${player.injury_status || isByeWeek(player) ? "negative" : "positive"}">${player.injury_status || (isByeWeek(player) ? "BYE" : "Aktiv")}</strong></li>`);
  flags.push(`<li><span>Depth Chart</span><strong>${player.depth_chart_position || "–"}</strong></li>`);
  flags.push(`<li><span>Gegner</span><strong>${matchupLabel(player)}</strong></li>`);
  flags.push(`<li><span>Prognose</span><strong>${availability(player) === "unavailable" || isByeWeek(player) ? "0.00" : formatPoints(player.projected_points)} Pkt.</strong></li>`);
  flags.push(`<li><span>Ist-Punkte</span><strong>${actualPointsLabel(player)} Pkt.</strong></li>`);
  flags.push(`<li><span>Rostered</span><strong>${formatPercent(player.rostered_percent)}</strong></li>`);
  flags.push(`<li><span>Startquote</span><strong>${formatPercent(player.start_percent)}</strong></li>`);
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

function positionsCompatible(a, b) {
  if (a.position === b.position) return true;
  const rosterPositions = new Set(state.league.league.roster_positions || []);
  if (rosterPositions.has("WRRB_FLEX") && [a.position, b.position].every(position => ["RB", "WR"].includes(position))) return true;
  if (rosterPositions.has("FLEX") && [a.position, b.position].every(position => ["RB", "WR", "TE"].includes(position))) return true;
  return false;
}

function kickoffLocked(player) {
  return Boolean(player.game_start && new Date(player.game_start) <= new Date());
}

function setRecommendation(tone, titleText, bodyText, metaText = "") {
  const card = $("#recommendation");
  card.classList.remove("good", "warning", "danger", "neutral");
  card.classList.add(tone);
  $("#recommendation-title").textContent = titleText;
  $("#recommendation-text").textContent = bodyText;
  const meta = $("#recommendation-meta");
  meta.textContent = metaText;
  meta.hidden = !metaText;
}

function consensusComparison(a, b) {
  const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
  const projectionDifference = Number(a.projected_points) - Number(b.projected_points);
  const projectionRatings = [
    50 + clamp(projectionDifference * 10, -50, 50),
    50 - clamp(projectionDifference * 10, -50, 50)
  ];
  const players = [a, b];
  const definitions = [
    { key: "projection", label: "Ligaprognose", weight: 45, values: projectionRatings },
    { key: "start", label: "Startquoten-Konsens", weight: 25, values: players.map(player => player.start_percent) },
    { key: "usage", label: "Rolle & Nutzung", weight: 15, values: players.map(player => player.usage_percentile) },
    { key: "matchup", label: "Matchup", weight: 10, values: players.map(player => player.matchup_rating === null || player.matchup_rating === undefined ? null : 50 + Number(player.matchup_rating) * 50) },
    { key: "health", label: "Einsatzsicherheit", weight: 5, values: players.map(player => availability(player) === "uncertain" ? 30 : 100) }
  ];
  const usable = definitions.filter(definition => definition.values.every(value => value !== null && value !== undefined && Number.isFinite(Number(value))));
  const totalWeight = usable.reduce((sum, definition) => sum + definition.weight, 0);
  const scores = players.map((_, playerIndex) => usable.reduce(
    (sum, definition) => sum + clamp(Number(definition.values[playerIndex]), 0, 100) * definition.weight,
    0
  ) / totalWeight);
  const decisive = usable
    .map(definition => ({
      ...definition,
      impact: Math.abs(Number(definition.values[0]) - Number(definition.values[1])) * definition.weight / totalWeight
    }))
    .sort((left, right) => right.impact - left.impact)[0];
  return { scores, basis: decisive?.label || "Ligaprognose", signals: usable.map(definition => definition.key) };
}

function renderComparison() {
  if (!state.league) return;
  const players = selectablePlayers();
  const a = players.find((player) => player.player_id === $("#player-a").value);
  const b = players.find((player) => player.player_id === $("#player-b").value);
  if (!a || !b) return;
  $("#comparison").innerHTML = comparisonCard(a, "Spieler A") + comparisonCard(b, "Spieler B");

  const aAvailability = availability(a);
  const bAvailability = availability(b);
  if (a.player_id === b.player_id) {
    setRecommendation("neutral", "Bitte zwei unterschiedliche Spieler wählen", "Für einen Vergleich müssen Spieler A und Spieler B verschieden sein.");
  } else if (state.week < Number(state.context.nfl_week)) {
    const aPoints = Number(a.actual_points);
    const bPoints = Number(b.actual_points);
    if (!Number.isFinite(aPoints) || !Number.isFinite(bPoints)) {
      setRecommendation("neutral", "Für diese Woche fehlen Ergebnisdaten", "Sobald beide Spielerpunkte verfügbar sind, zeigt der Rückblick die bessere Entscheidung.");
    } else {
      const winner = aPoints >= bPoints ? a : b;
      const loser = winner === a ? b : a;
      const difference = Math.abs(aPoints - bPoints);
      setRecommendation(
        difference === 0 ? "neutral" : "good",
        difference === 0 ? "Beide Spieler erzielten gleich viele Punkte" : `${winner.name} war die bessere Wahl`,
        `${winner.name} erzielte ${formatPoints(winner.actual_points)} Punkte, ${loser.name} ${formatPoints(loser.actual_points)} Punkte.`,
        difference === 0 ? "Rückblick · Gleichstand" : `Rückblick · Vorteil ${formatPoints(difference)} Punkte`
      );
    }
  } else if (!positionsCompatible(a, b)) {
    setRecommendation("neutral", "Diese Positionen sind nicht austauschbar", `${a.position} und ${b.position} konkurrieren in dieser Liga nicht um denselben Startplatz.`);
  } else if (kickoffLocked(a) || kickoffLocked(b)) {
    const locked = [a, b].filter(kickoffLocked).map(player => player.name).join(" und ");
    setRecommendation("warning", "Lineup-Entscheidung bereits gesperrt", `${locked} hat bereits gespielt oder das Spiel hat begonnen. Sleeper erlaubt deshalb keinen Wechsel mehr.`, "Kickoff-Sperre aktiv");
  } else if (isByeWeek(a) && isByeWeek(b)) {
    setRecommendation("danger", "Beide Spieler haben Bye Week", `${a.name} und ${b.name} können in dieser Woche keine Punkte erzielen.`);
  } else if (isByeWeek(a)) {
    setRecommendation("good", `Starte ${b.name}`, `${a.name} hat in dieser Woche spielfrei und erhält deshalb keine Start-Empfehlung.`, "Klare Empfehlung · Bye Week");
  } else if (isByeWeek(b)) {
    setRecommendation("good", `Starte ${a.name}`, `${b.name} hat in dieser Woche spielfrei und erhält deshalb keine Start-Empfehlung.`, "Klare Empfehlung · Bye Week");
  } else if (aAvailability === "unavailable" && bAvailability === "unavailable") {
    setRecommendation("danger", "Keiner der beiden Spieler ist aktuell einsatzfähig", `${a.name} (${a.injury_status || "IR"}) und ${b.name} (${b.injury_status || "IR"}) dürfen aktuell nicht als Start-Option gewertet werden.`);
  } else if (aAvailability === "unavailable") {
    setRecommendation("good", `Starte ${b.name}`, `${a.name} ist mit „${a.injury_status || "IR"}“ nicht einsatzfähig und erhält deshalb keine Start-Empfehlung.`, "Klare Empfehlung · Statusentscheidung");
  } else if (bAvailability === "unavailable") {
    setRecommendation("good", `Starte ${a.name}`, `${b.name} ist mit „${b.injury_status || "IR"}“ nicht einsatzfähig und erhält deshalb keine Start-Empfehlung.`, "Klare Empfehlung · Statusentscheidung");
  } else {
    const aProjection = Number(a.projected_points);
    const bProjection = Number(b.projected_points);
    if (!Number.isFinite(aProjection) || !Number.isFinite(bProjection)) {
      setRecommendation("neutral", "Noch keine belastbare Prognose verfügbar", "Für mindestens einen Spieler fehlen aktuell ligaabhängige Projektionsdaten. Bitte später erneut prüfen.");
      return;
    }
    const consensus = consensusComparison(a, b);
    let winnerIndex = consensus.scores[0] >= consensus.scores[1] ? 0 : 1;
    let loserIndex = winnerIndex === 0 ? 1 : 0;
    let winner = [a, b][winnerIndex];
    let loser = [a, b][loserIndex];
    let decisionBasis = consensus.basis;
    const projectionDifference = Math.abs(aProjection - bProjection);
    if (availability(winner) === "uncertain" && availability(loser) === "available" && projectionDifference < 3) {
      [winner, loser] = [loser, winner];
      [winnerIndex, loserIndex] = [loserIndex, winnerIndex];
      decisionBasis = "Einsatzsicherheit";
    }
    const winnerProjection = Number(winner.projected_points);
    const loserProjection = Number(loser.projected_points);
    const projectionAdvantage = winnerProjection - loserProjection;
    const scoreAdvantage = consensus.scores[winnerIndex] - consensus.scores[loserIndex];
    const confidence = scoreAdvantage >= 15 ? "Hoch" : scoreAdvantage >= 7 ? "Mittel" : "Knapp";
    const switched = winner.slot === "BENCH" && loser.slot === "STARTER";
    const statusNote = availability(winner) === "uncertain"
      ? ` ${winner.name} ist allerdings ${winner.injury_status}; Status vor dem Kickoff erneut prüfen.`
      : availability(loser) === "uncertain"
      ? ` Der unsichere Status von ${loser.name} spricht zusätzlich für diese Wahl.`
      : "";
    const extraSignals = [
      consensus.signals.includes("usage") ? `Nutzung ${formatPoints(winner.usage_opportunities, "–")} Opportunities/Spiel` : null,
      consensus.signals.includes("matchup") ? `Matchup ${Number(winner.matchup_index) >= 100 ? "+" : ""}${formatPoints(Number(winner.matchup_index) - 100)} % gegenüber dem Liga-Schnitt` : null
    ].filter(Boolean).join(" · ");
    const recommendationText = `${winner.name} erreicht im Vienna-Steel-Konsens ${formatPoints(consensus.scores[winnerIndex])} Punkte, ${loser.name} ${formatPoints(consensus.scores[loserIndex])}. Die Ligaprognosen liegen bei ${formatPoints(winnerProjection)} zu ${formatPoints(loserProjection)} Punkten; ausschlaggebend ist „${decisionBasis}“.${extraSignals ? ` ${extraSignals}.` : ""}${statusNote}`;
    setRecommendation(
      availability(winner) === "uncertain" ? "warning" : "good",
      `${switched ? "Wechsel zu" : "Starte"} ${winner.name}`,
      recommendationText,
      `Sicherheit: ${availability(winner) === "uncertain" ? "Riskant" : confidence} · Basis: ${decisionBasis} · Score-Vorsprung ${formatPoints(Math.abs(scoreAdvantage))}`
    );
  }
}

function rankingRosterLabel(player) {
  if (player.roster_status === "STARTER") return "Dein Starter";
  if (player.roster_status === "BENCH") return "Deine Bank";
  if (player.roster_status === "IR") return "Dein IR";
  if (player.roster_status === "WAIVER") return "Waiver";
  return player.fantasy_team || "Vergeben";
}

function renderRankings() {
  if (!state.league) return;
  const source = state.league.rankings?.[state.rankingPosition] || [];
  const query = state.rankingSearch.trim().toLowerCase();
  const players = source.filter(player => !query || `${player.name} ${player.team}`.toLowerCase().includes(query));
  const list = $("#ranking-list");
  if (!source.length) {
    list.innerHTML = `<div class="ranking-empty"><strong>Rankings werden vorbereitet</strong><span>Nach der nächsten Datensynchronisierung erscheint hier die aktuelle Wochenrangliste.</span></div>`;
    return;
  }
  if (!players.length) {
    list.innerHTML = `<div class="ranking-empty"><strong>Kein Spieler gefunden</strong><span>Versuche einen anderen Namen oder ein anderes Team.</span></div>`;
    return;
  }
  list.innerHTML = players.map(player => {
    const matchupDifference = player.matchup_index === null || player.matchup_index === undefined
      ? null
      : Number(player.matchup_index) - 100;
    const matchupClass = matchupDifference === null ? "" : matchupDifference >= 5 ? "positive" : matchupDifference <= -5 ? "negative" : "";
    const availabilityClass = player.unavailable ? "unavailable" : availability(player) === "uncertain" ? "uncertain" : "";
    return `<article class="ranking-row ${availabilityClass}">
      <div class="ranking-rank"><span>#</span>${player.rank}</div>
      <div class="ranking-player">
        <span class="ranking-photo"><img src="${playerImage(player)}" alt="" loading="lazy" onerror="this.src='./favicon.svg'" />${statusBadge({ ...player, slot: player.roster_status })}</span>
        <span><strong>${player.name}</strong><small>${player.team || "FA"} · ${player.position} · ${rankingRosterLabel(player)}</small></span>
      </div>
      <strong class="ranking-score">${formatPoints(player.consensus_score)}</strong>
      <span><strong>${formatPoints(player.projected_points)}</strong><small>Pkt.</small></span>
      <span><strong>${formatPercent(player.start_percent)}</strong><small>Startquote</small></span>
      <span class="${matchupClass}"><strong>${isByeWeek(player) ? "BYE" : matchupDifference === null ? "–" : `${matchupDifference >= 0 ? "+" : ""}${formatPoints(matchupDifference)}%`}</strong><small>${isByeWeek(player) ? "Spielfrei" : player.week_opponent ? `vs ${player.week_opponent}` : "Offen"}</small></span>
      <span class="ranking-status ${player.roster_status?.toLowerCase() || ""}">${rankingRosterLabel(player)}</span>
    </article>`;
  }).join("");
}

function rankingPlayer(playerId, position) {
  return (state.league.rankings?.[position] || [])
    .find(item => String(item.player_id) === String(playerId)) || null;
}

function enrichedWaiverPlayer(player, position = state.waiverPosition) {
  const ranking = rankingPlayer(player.player_id, position);
  return {
    ...player,
    ...(ranking || {}),
    waiver_score: ranking?.consensus_score ?? null
  };
}

function rosteredWaiverProfile(rostered) {
  const ranking = rankingPlayer(rostered.player_id, rostered.position);
  const profile = { ...rostered, ...(ranking || {}) };
  const consensus = Number(ranking?.consensus_score);
  const rosteredPercent = Number(profile.rostered_percent);
  const startPercent = Number(profile.start_percent);
  const projection = Number(profile.projected_points);
  const trend = Number(profile.trending_adds_24h || 0);
  const protectedPlayer =
    rostered.slot !== "BENCH" ||
    availability(rostered) !== "available" ||
    (Number.isFinite(rosteredPercent) && rosteredPercent >= 85) ||
    (Number.isFinite(startPercent) && startPercent >= 30) ||
    (Number.isFinite(consensus) && consensus >= 72) ||
    (["RB", "WR"].includes(rostered.position) && trend >= 5000);
  const dropScore =
    (Number.isFinite(consensus) ? consensus * 0.5 : 25) +
    (Number.isFinite(rosteredPercent) ? rosteredPercent * 0.25 : 12.5) +
    (Number.isFinite(startPercent) ? startPercent * 0.15 : 7.5) +
    (Number.isFinite(projection) ? Math.min(25, projection) * 0.4 : 5) +
    Math.min(10, Math.log10(trend + 1) * 2);
  return { ...profile, roster_score: Number.isFinite(consensus) ? consensus : null, drop_score: dropScore, protected_player: protectedPlayer };
}

function waiverPositionNeed(position) {
  const team = activeWeekData().team || [];
  const starters = team.filter(player => player.slot === "STARTER" && player.position === position);
  const unavailableStarters = starters.filter(player => {
    if (isByeWeek(player)) return true;
    if (availability(player) === "unavailable") return true;
    const projection = player.projected_points === null || player.projected_points === undefined
      ? null
      : Number(player.projected_points);
    const kickoffPending = !player.game_start || new Date(player.game_start) > new Date();
    return kickoffPending && projection !== null && Number.isFinite(projection) && projection <= 0;
  });
  const playableBench = team.filter(player => player.slot === "BENCH" && player.position === position && availability(player) === "available" && !isByeWeek(player));
  return {
    urgent: unavailableStarters.length > 0 && playableBench.length === 0,
    unavailableStarters,
    playableBench
  };
}

function waiverDropCandidate(player, need = waiverPositionNeed(player.position)) {
  const team = activeWeekData().team || [];
  const candidates = team
    .filter(rostered => rostered.slot === "BENCH" && availability(rostered) === "available")
    .map(rosteredWaiverProfile)
    .filter(rostered => !rostered.protected_player)
    .sort((a, b) => Number(a.drop_score) - Number(b.drop_score));

  if (!candidates.length) return null;
  if (need.urgent) return candidates[0];

  const samePosition = candidates.filter(rostered => rostered.position === player.position);
  return samePosition[0] || candidates[0];
}

function faabRecommendation(tier, player, scoreDifference) {
  const budget = state.league?.faab;
  if (!budget?.enabled || tier === "none") return { minimum: 0, maximum: 0, label: budget?.enabled ? "$0" : "–" };
  const total = Number(budget.total || 100);
  const remaining = Number(budget.remaining ?? Math.max(0, total - Number(budget.used || 0)));
  if (remaining <= 0) return { minimum: 0, maximum: 0, label: "$0 · Budget aufgebraucht" };

  let range = tier === "must" ? [10, 18] : tier === "upgrade" ? [4, 9] : [1, 3];
  if (tier === "must" && Number(player.rostered_percent || 0) >= 60 && scoreDifference >= 20) range = [15, 25];
  if (player.position === "QB" && tier === "must" && Number(player.rostered_percent || 0) < 30) range = [3, 6];
  if (["K", "DEF"].includes(player.position)) range = tier === "must" ? [3, 6] : tier === "upgrade" ? [1, 3] : [0, 1];
  const minimum = Math.min(remaining, Math.round(total * range[0] / 100));
  const maximum = Math.min(remaining, Math.max(minimum, Math.round(total * range[1] / 100)));
  return { minimum, maximum, label: minimum === maximum ? `$${minimum}` : `$${minimum}–${maximum}` };
}

function waiverRecommendation(player) {
  if (availability(player) === "unavailable") {
    return { tier: "none", title: "Kein Bedarf", drop: null, difference: null, reason: `Status ${player.injury_status || "nicht einsatzfähig"}`, faab: faabRecommendation("none", player, 0) };
  }
  const playerScore = Number(player.waiver_score);
  if (!Number.isFinite(playerScore)) {
    return { tier: "watch", title: "Watchlist", drop: null, difference: null, reason: "Noch keine vollständige Wochenbewertung", faab: faabRecommendation("watch", player, 0) };
  }
  const need = waiverPositionNeed(player.position);
  const drop = waiverDropCandidate(player, need);
  if (need.urgent) {
    const missing = need.unavailableStarters.map(starter => starter.name).join(", ") || `dein ${player.position}-Starter`;
    if (isByeWeek(player)) {
      return {
        tier: "watch",
        title: "Watchlist",
        drop: null,
        difference: null,
        reason: `${player.name} hat selbst Bye Week und löst den akuten ${player.position}-Bedarf nicht`,
        urgentNeed: false,
        faab: faabRecommendation("watch", player, 0)
      };
    }
    return {
      tier: "must",
      title: "Must Add",
      drop,
      difference: drop && Number.isFinite(Number(drop.roster_score)) ? playerScore - Number(drop.roster_score) : null,
      reason: `Akuter Ersatzbedarf: ${missing} ist nicht einsatzfähig und auf der Bank fehlt ein spielbereiter Ersatz`,
      urgentNeed: true,
      faab: faabRecommendation("must", player, 0)
    };
  }
  if (!drop) {
    const tier = playerScore >= 70 ? "upgrade" : "watch";
    return {
      tier,
      title: tier === "upgrade" ? "Top Target" : "Watchlist",
      drop: null,
      difference: null,
      reason: `Interessanter ${player.position}, aber aktuell kein verantwortbarer Drop`,
      urgentNeed: false,
      faab: faabRecommendation(tier, player, 0)
    };
  }
  const difference = playerScore - Number(drop.roster_score);
  const tier = difference >= 15 && playerScore >= 65 ? "must" : difference >= 7 ? "upgrade" : difference >= 2 ? "watch" : "none";
  const titles = { must: "Must Add", upgrade: "Upgrade", watch: "Watchlist", none: "Kein Bedarf" };
  const reasons = {
    must: `Deutliches Upgrade gegenüber ${drop.name}`,
    upgrade: `Sinnvolles Upgrade gegenüber ${drop.name}`,
    watch: `Kleiner Vorteil gegenüber ${drop.name}`,
    none: `${drop.name} ist aktuell mindestens gleichwertig`
  };
  return { tier, title: titles[tier], drop, difference, reason: reasons[tier], urgentNeed: false, faab: faabRecommendation(tier, player, difference) };
}

function waiverRole(player, recommendation) {
  if (recommendation.urgentNeed) return `Akuter ${player.position}-Ersatz`;
  if (recommendation.tier === "none") return "Aktuell kein Kader-Upgrade";
  if (recommendation.tier === "watch") return "Watchlist / Tiefe";
  const starters = activeWeekData().team
    .filter(item => item.slot === "STARTER" && item.position === player.position)
    .map(item => rankingPlayer(item.player_id, item.position)?.consensus_score)
    .filter(value => Number.isFinite(Number(value)));
  const weakestStarter = starters.length ? Math.min(...starters.map(Number)) : null;
  if (weakestStarter !== null && Number(player.waiver_score) > weakestStarter) return "Starter-Potenzial";
  return recommendation.tier === "must" ? "Prioritäres Bank-Upgrade" : "Bank-Upgrade";
}

function waiverDecisionReasons(player, recommendation) {
  const reasons = [];
  if (recommendation.urgentNeed) reasons.push(recommendation.reason);
  if (player.projected_points !== null && player.projected_points !== undefined && Number.isFinite(Number(player.projected_points))) reasons.push(`${formatPoints(player.projected_points)} prognostizierte Punkte im Liga-Scoring`);
  if (player.start_percent !== null && player.start_percent !== undefined && Number.isFinite(Number(player.start_percent))) reasons.push(`${formatPercent(player.start_percent)} Startquote`);
  if (player.usage_opportunities !== null && player.usage_opportunities !== undefined && Number.isFinite(Number(player.usage_opportunities))) reasons.push(`${formatPoints(player.usage_opportunities)} Opportunities pro Spiel`);
  if (player.matchup_index !== null && player.matchup_index !== undefined && Number.isFinite(Number(player.matchup_index))) {
    const difference = Number(player.matchup_index) - 100;
    reasons.push(`Matchup ${difference >= 0 ? "+" : ""}${formatPoints(difference)} % zum Liga-Schnitt`);
  }
  if (recommendation.drop) reasons.push(`${recommendation.difference >= 0 ? "+" : ""}${formatPoints(recommendation.difference)} VS Score gegenüber ${recommendation.drop.name}`);
  if (player.injury_status) reasons.push(`Einsatzstatus ${player.injury_status}`);
  return reasons.length ? reasons : [recommendation.reason];
}

function findWaiverPlayer(playerId, position) {
  const leagueId = String(state.league.league.league_id);
  const payload = state.waivers[`${leagueId}:${position}`];
  const player = (payload?.available || []).find(item => String(item.player_id) === String(playerId));
  return player ? enrichedWaiverPlayer(player, position) : null;
}

function openWaiverDetails(playerId, position) {
  const player = findWaiverPlayer(playerId, position);
  if (!player) return;
  const recommendation = waiverRecommendation(player);
  const role = waiverRole(player, recommendation);
  const reasons = waiverDecisionReasons(player, recommendation);
  const matchupDifference = player.matchup_index !== null && player.matchup_index !== undefined && Number.isFinite(Number(player.matchup_index)) ? Number(player.matchup_index) - 100 : null;
  const dropComparison = recommendation.drop
    ? `<div class="waiver-dialog-move"><span><small>Add</small><strong>${player.name}</strong><em>${formatPoints(player.waiver_score)} VS Score</em></span><b>→</b><span><small>Drop</small><strong>${recommendation.drop.name}</strong><em>${formatPoints(recommendation.drop.roster_score)} VS Score</em></span></div>`
    : `<div class="waiver-dialog-note">${recommendation.reason}</div>`;

  $("#waiver-dialog-content").innerHTML = `
    <div class="waiver-dialog-hero">
      <span class="waiver-dialog-photo"><img src="${playerImage(player)}" alt="" onerror="this.src='./favicon.svg'" />${statusBadge(player)}</span>
      <div><p class="eyebrow">${recommendation.title} · ${role}</p><h2 id="waiver-dialog-title">${player.name}</h2><span>${player.team || "FA"} · ${player.position} · ${player.depth_chart_position || "Depth Chart offen"}</span></div>
      <div class="waiver-dialog-faab"><small>FAAB</small><strong>${recommendation.faab.label}</strong></div>
    </div>
    ${dropComparison}
    <div class="waiver-dialog-stats">
      <span><small>VS Score</small><strong>${formatPoints(player.waiver_score)}</strong></span>
      <span><small>Prognose</small><strong>${formatPoints(player.projected_points)} Pkt.</strong></span>
      <span><small>Rostered</small><strong>${formatPercent(player.rostered_percent)}</strong></span>
      <span><small>Startquote</small><strong>${formatPercent(player.start_percent)}</strong></span>
      <span><small>Nutzung</small><strong>${formatPoints(player.usage_opportunities)} Opp.</strong></span>
      <span><small>Trending</small><strong>+${Number(player.trending_adds_24h || 0).toLocaleString("de-AT")}</strong></span>
    </div>
    <div class="waiver-dialog-matchup"><span><small>Nächstes Matchup</small><strong>${matchupDisplay(player)}</strong></span><span><small>Matchup-Wert</small><strong>${matchupDifference === null ? "–" : `${matchupDifference >= 0 ? "+" : ""}${formatPoints(matchupDifference)} %`}</strong></span></div>
    <div class="waiver-dialog-reasons"><p class="eyebrow">Warum diese Empfehlung?</p><ul>${reasons.map(reason => `<li>${reason}</li>`).join("")}</ul><small>Die FAAB-Spanne ist eine Entscheidungshilfe und kein automatisches Gebot.</small></div>`;
  const dialog = $("#waiver-dialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function renderWaiverBudget() {
  const budget = state.league?.faab;
  const element = $("#waiver-budget");
  if (!budget?.enabled) {
    element.innerHTML = `<span>Waiver-System</span><strong>Priorität</strong>`;
    return;
  }
  const remaining = Number(budget.remaining ?? Math.max(0, Number(budget.total || 0) - Number(budget.used || 0)));
  element.innerHTML = `<span>FAAB verfügbar</span><strong>$${remaining} <small>von $${Number(budget.total || 0)}</small></strong>`;
}

async function loadWaivers(position = state.waiverPosition) {
  if (!state.league || !state.profile) return;
  const leagueId = String(state.league.league.league_id);
  const cacheKey = `${leagueId}:${position}`;
  if (!state.waivers[cacheKey]) {
    $("#waiver-list").innerHTML = `<div class="ranking-empty"><strong>Waiver-Daten werden geladen</strong><span>Einen Moment bitte.</span></div>`;
    state.waivers[cacheKey] = await loadFantasyDocument(
      "fantasyUsers",
      state.profile.sleeperUserId,
      "leagues",
      leagueId,
      "waivers",
      position
    );
  }
  renderWaivers();
  await loadWaiverPriorities();
}

async function loadWaiverPriorities() {
  if (!state.league || !state.profile) return;
  const leagueId = String(state.league.league.league_id);
  const positions = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const missing = positions.filter(position => !state.waivers[`${leagueId}:${position}`]);
  if (missing.length) {
    const payloads = await Promise.all(missing.map(position => loadFantasyDocument(
      "fantasyUsers",
      state.profile.sleeperUserId,
      "leagues",
      leagueId,
      "waivers",
      position
    )));
    missing.forEach((position, index) => { state.waivers[`${leagueId}:${position}`] = payloads[index]; });
  }
  renderWaiverPriorities();
}

function renderWaiverPriorities() {
  const list = $("#waiver-priorities-list");
  if (!state.league || !list) return;
  const leagueId = String(state.league.league.league_id);
  const positions = ["QB", "RB", "WR", "TE", "K", "DEF"];
  const tierOrder = { must: 3, upgrade: 2, watch: 1, none: 0 };
  const rankedRecommendations = positions.flatMap(position => {
    const payload = state.waivers[`${leagueId}:${position}`];
    return (payload?.available || []).map(player => {
      const enriched = enrichedWaiverPlayer(player, position);
      return { player: enriched, recommendation: waiverRecommendation(enriched) };
    });
  }).filter(item => item.recommendation.tier !== "none")
    .sort((a, b) =>
      Number(Boolean(b.recommendation.urgentNeed)) - Number(Boolean(a.recommendation.urgentNeed)) ||
      tierOrder[b.recommendation.tier] - tierOrder[a.recommendation.tier] ||
      Number(b.recommendation.difference || 0) - Number(a.recommendation.difference || 0) ||
      Number(b.player.waiver_score || 0) - Number(a.player.waiver_score || 0)
    );
  const recommendations = [];
  const usedPositions = new Set();
  const usedDrops = new Set();
  for (const item of rankedRecommendations) {
    const dropId = item.recommendation.drop?.player_id || null;
    if (usedPositions.has(item.player.position) || (dropId && usedDrops.has(String(dropId)))) continue;
    recommendations.push(item);
    usedPositions.add(item.player.position);
    if (dropId) usedDrops.add(String(dropId));
    if (recommendations.length === 3) break;
  }

  if (!recommendations.length) {
    list.innerHTML = `<div class="ranking-empty"><strong>Aktuell kein klarer Waiver-Move</strong><span>Dein Kader ist gegenüber den verfügbaren Spielern mindestens gleichwertig.</span></div>`;
    return;
  }

  list.innerHTML = recommendations.map(({ player, recommendation }, index) => {
    const drop = recommendation.drop ? `Drop ${recommendation.drop.name}` : "Kein sicherer Drop";
    const difference = recommendation.difference === null ? recommendation.reason : `${recommendation.difference >= 0 ? "+" : ""}${formatPoints(recommendation.difference)} VS Score`;
    return `<article class="waiver-priority-card ${recommendation.tier}">
      <span class="waiver-priority-number">${index + 1}</span>
      <span class="waiver-priority-photo"><img src="${playerImage(player)}" alt="" loading="lazy" onerror="this.src='./favicon.svg'" />${statusBadge(player)}</span>
      <span class="waiver-priority-copy"><small>${recommendation.title} · ${player.position}</small><strong>Add ${player.name}</strong><span>${drop} · ${difference}</span></span>
      <span class="waiver-priority-bid"><small>FAAB</small><strong>${recommendation.faab.label}</strong></span>
      <button class="waiver-detail-button" data-waiver-player="${player.player_id}" data-waiver-position="${player.position}" type="button">Details</button>
    </article>`;
  }).join("");
}

function renderWaivers() {
  if (!state.league) return;
  renderWaiverBudget();
  const leagueId = String(state.league.league.league_id);
  const payload = state.waivers[`${leagueId}:${state.waiverPosition}`];
  if (!payload) return;
  const query = state.waiverSearch.trim().toLowerCase();
  const source = [...(payload.available || [])]
    .map(player => enrichedWaiverPlayer(player, state.waiverPosition))
    .sort((a, b) => Number(b.waiver_score || 0) - Number(a.waiver_score || 0) || Number(b.trending_adds_24h || 0) - Number(a.trending_adds_24h || 0));
  const players = source.filter(player => !query || `${player.name} ${player.team || ""}`.toLowerCase().includes(query));
  const list = $("#waiver-list");
  if (!players.length) {
    list.innerHTML = `<div class="ranking-empty"><strong>Keine verfügbaren Spieler gefunden</strong><span>Versuche eine andere Position oder Suche.</span></div>`;
    return;
  }
  list.innerHTML = players.map((player, index) => {
    const availabilityClass = player.unavailable ? "unavailable" : availability(player) === "uncertain" ? "uncertain" : isByeWeek(player) ? "bye" : "";
    const status = player.injury_status || (isByeWeek(player) ? "BYE" : "Verfügbar");
    const recommendation = waiverRecommendation(player);
    const difference = recommendation.difference === null ? "" : `${recommendation.difference >= 0 ? "+" : ""}${formatPoints(recommendation.difference)} VS Score`;
    const dropText = recommendation.drop && recommendation.tier !== "none" ? `Add ${player.name} · Drop ${recommendation.drop.name}` : recommendation.reason;
    return `<article class="waiver-row ${availabilityClass}">
      <div class="waiver-rank"><span>#</span>${index + 1}</div>
      <div class="ranking-player">
        <span class="ranking-photo"><img src="${playerImage(player)}" alt="" loading="lazy" onerror="this.src='./favicon.svg'" />${statusBadge(player)}</span>
        <span><strong>${player.name}</strong><small>${player.team || "FA"} · ${player.position || state.waiverPosition} · ${player.depth_chart_position || "Depth Chart offen"}</small></span>
      </div>
      <strong class="waiver-score">${formatPoints(player.waiver_score)}</strong>
      <span><strong>${availability(player) === "unavailable" || isByeWeek(player) ? "0.00" : formatPoints(player.projected_points)}</strong><small>Pkt.</small></span>
      <span><strong>${formatPercent(player.rostered_percent)}</strong><small>Rostered</small></span>
      <span class="waiver-trend"><strong>+${Number(player.trending_adds_24h || 0).toLocaleString("de-AT")}</strong><small>Adds</small></span>
      <span class="waiver-status ${availabilityClass}">${status}</span>
      <div class="waiver-recommendation ${recommendation.tier}">
        <span class="waiver-tier">${recommendation.title}</span>
        <span class="waiver-move"><strong>${dropText}</strong><small>${difference || recommendation.reason}</small></span>
        <span class="waiver-faab"><small>FAAB-Empfehlung</small><strong>${recommendation.faab.label}</strong></span>
        <button class="waiver-detail-button" data-waiver-player="${player.player_id}" data-waiver-position="${player.position}" type="button">Details</button>
      </div>
    </article>`;
  }).join("");
}

async function switchView(viewId) {
  state.view = viewId;
  document.querySelectorAll(".app-view").forEach((view) => { view.hidden = view.id !== viewId; });
  document.querySelectorAll("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === viewId));
  localStorage.setItem("vienna-steel-view", viewId);
  if (viewId === "waiver-view") await loadWaivers();
}

function renderAlerts() {
  const injured = activeWeekData().team.filter((player) => player.injury_status);
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
  const data = activeWeekData();
  const teamById = new Map(data.team.map((player) => [String(player.player_id), player]));
  const benchPositionOrder = new Map(["QB", "RB", "WR", "TE", "K", "DEF"].map((position, index) => [position, index]));
  const starterIds = (data.matchup?.starters || []).map(String);
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
  const reserves = data.team
    .filter((player) => player.slot === "BENCH")
    .map((player) => ({ ...player, displaySlot: "RES" }))
    .sort((a, b) =>
      (benchPositionOrder.get(a.position) ?? 99) - (benchPositionOrder.get(b.position) ?? 99) ||
      String(a.name || "").localeCompare(String(b.name || ""), "de")
    );
  const injuredReserve = data.team.filter((player) => player.slot === "IR").map((player) => ({ ...player, displaySlot: "IR" }));
  const groups = [
    { slot: "STARTER", label: "Aufstellung", players: starters },
    { slot: "BENCH", label: "Reserve", players: reserves },
    { slot: "IR", label: "Injured Reserve", players: injuredReserve }
  ].filter((group) => (state.slot === "ALL" || state.slot === group.slot) && group.players.length);

  $("#roster").innerHTML = groups.map((group) => `
    <div class="roster-group-title"><span>${group.label}</span><small>${group.players.length} Spieler</small></div>
    ${group.players.map((player) => `
    <article class="player-card availability-${isByeWeek(player) ? "bye" : availability(player)}">
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
        <div class="week-stat"><span>Matchup</span><div class="week-value matchup-value"><strong>${matchupDisplay(player)}</strong></div></div>
        <div class="week-stat"><span>Prognose</span><div class="week-value"><strong class="projection">${availability(player) === "unavailable" || isByeWeek(player) ? "0.00" : formatPoints(player.projected_points)}</strong><small>Pkt.</small></div></div>
        <div class="week-stat"><span>Erreicht</span><div class="week-value"><strong>${actualPointsLabel(player)}</strong><small>Pkt.</small></div></div>
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
  state.league = await loadFantasyDocument(
    "fantasyUsers",
    state.profile.sleeperUserId,
    "leagues",
    String(league.league_id)
  );
  state.waivers = {};
  const availableWeeks = state.league.available_weeks || [Number(state.league.week)];
  const currentWeek = Number(state.context.nfl_week);
  state.week = availableWeeks.includes(currentWeek) ? currentWeek : Number(state.league.week);
  localStorage.setItem("vienna-steel-league", leagueId);
  renderLeague();
  if (state.view === "waiver-view") await loadWaivers();
  $("#loading").hidden = true;
  $("#dashboard").hidden = false;
}

function selectWeek(week) {
  const availableWeeks = state.league.available_weeks || [Number(state.league.week)];
  const selected = Number(week);
  if (!availableWeeks.includes(selected)) return;
  state.week = selected;
  localStorage.setItem(`vienna-steel-week-${state.league.league.league_id}`, String(selected));
  renderLeague();
}

async function init() {
  try {
    $("#error").hidden = true;
    $("#loading").hidden = false;
    state.context = await loadFantasyDocument(
      "fantasyUsers",
      state.profile.sleeperUserId,
      "private",
      "context"
    );
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
$("#matchup-week-picker").addEventListener("change", (event) => selectWeek(event.target.value));
$("#previous-week").addEventListener("click", () => selectWeek(state.week - 1));
$("#next-week").addEventListener("click", () => selectWeek(state.week + 1));
$("#retry").addEventListener("click", init);
document.querySelectorAll("[data-slot]").forEach((button) => button.addEventListener("click", () => {
  state.slot = button.dataset.slot;
  document.querySelectorAll("[data-slot]").forEach((item) => item.classList.toggle("active", item === button));
  renderRoster();
}));
document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view).catch(console.error)));
$("#player-a").addEventListener("change", renderComparison);
$("#player-b").addEventListener("change", renderComparison);
$("#ranking-search").addEventListener("input", (event) => {
  state.rankingSearch = event.target.value;
  renderRankings();
});
document.querySelectorAll("[data-ranking-position]").forEach((button) => button.addEventListener("click", () => {
  state.rankingPosition = button.dataset.rankingPosition;
  document.querySelectorAll("[data-ranking-position]").forEach((item) => item.classList.toggle("active", item === button));
  renderRankings();
}));
$("#waiver-search").addEventListener("input", (event) => {
  state.waiverSearch = event.target.value;
  renderWaivers();
});
document.querySelectorAll("[data-waiver-position]").forEach((button) => button.addEventListener("click", async () => {
  state.waiverPosition = button.dataset.waiverPosition;
  document.querySelectorAll("[data-waiver-position]").forEach((item) => item.classList.toggle("active", item === button));
  try {
    await loadWaivers();
  } catch (error) {
    console.error(error);
    $("#waiver-list").innerHTML = `<div class="ranking-empty"><strong>Waiver-Daten konnten nicht geladen werden</strong><span>Bitte versuche es gleich noch einmal.</span></div>`;
  }
}));
$("#waiver-view").addEventListener("click", (event) => {
  const button = event.target.closest("[data-waiver-player]");
  if (button) openWaiverDetails(button.dataset.waiverPlayer, button.dataset.waiverPosition);
});
$("#waiver-dialog-close").addEventListener("click", () => $("#waiver-dialog").close());
$("#waiver-dialog").addEventListener("click", (event) => {
  if (event.target === $("#waiver-dialog")) $("#waiver-dialog").close();
});

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("#login-submit");
  $("#login-error").hidden = true;
  button.disabled = true;
  button.textContent = "Anmeldung läuft …";
  try {
    await signInWithEmailAndPassword(auth, $("#login-email").value.trim(), $("#login-password").value);
    $("#login-password").value = "";
  } catch (error) {
    showLogin(loginErrorMessage(error));
  } finally {
    button.disabled = false;
    button.textContent = "Anmelden";
  }
});

$("#logout-button").addEventListener("click", () => signOut(auth));

setPersistence(auth, browserLocalPersistence).catch(console.error);
onAuthStateChanged(auth, async (user) => {
  await finishSplash();
  if (!user) {
    showLogin(authErrorMessage);
    authErrorMessage = "";
    return;
  }
  try {
    const profileSnapshot = await getDoc(doc(db, "users", user.uid));
    const profile = profileSnapshot.exists() ? profileSnapshot.data() : null;
    if (!profile || profile.active !== true || !profile.sleeperUserId) throw new Error("profile-not-active");
    state.profile = profile;
    showApp();
    await init();
  } catch (error) {
    console.error(error);
    authErrorMessage = "Dieser Account ist noch keinem aktiven Liga-Team zugeordnet.";
    await signOut(auth);
  }
});
