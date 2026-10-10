/**
 * Player-facing battle report at one of five accuracy levels, from exact numbers (Statistician) to pure
 * flavor (Roleplayer). Storyteller, the default, is vague but leaves no doubt about how bad things look.
 */
import { MODULE_ID, SIDES } from "../constants.js";

const pct = (p, digits = 0) => `${(p * 100).toFixed(digits)}%`;
const round5 = p => `${Math.round(p * 20) * 5}%`;

function oddsBand(p) {
  if ( p >= 0.9 ) return "overwhelming";
  if ( p >= 0.7 ) return "favorable";
  if ( p >= 0.5 ) return "even";
  if ( p >= 0.3 ) return "unfavorable";
  return "dire";
}

function deathBand(p) {
  if ( p >= 0.25 ) return "high";
  if ( p >= 0.08 ) return "real";
  if ( p >= 0.02 ) return "low";
  return "none";
}

function lengthBand(median) {
  if ( median <= 2 ) return "brief";
  if ( median <= 5 ) return "short";
  if ( median <= 8 ) return "long";
  return "grinding";
}

function oneIn(p) {
  if ( p <= 0 ) return null;
  return Math.max(1, Math.round(1 / p));
}

/**
 * @param {object} results     Batch results
 * @param {object} spec        BattleSpec
 * @param {string} accuracy    statistician | analyst | tactician | storyteller | roleplayer
 * @param {object} [options]   {hideEnemyNames}
 * @returns {{title: string, lines: string[], html: string}}
 */
export function buildReport(results, spec, accuracy, { hideEnemyNames = true } = {}) {
  const t = (key, data) => game.i18n.format(`FASTFIGHTING.Report.${key}`, data ?? {});
  const win = results.sides[SIDES.FRIENDLY]?.pWin ?? 0;
  const lose = Object.values(results.sides).filter(s => s.id !== SIDES.FRIENDLY).reduce((s, x) => s + x.pWin, 0);
  const death = results.pAnyPcDead;
  const rounds = results.rounds;
  const foes = Object.values(results.combatants).filter(c => c.side !== SIDES.FRIENDLY);
  const deadliest = [...foes].sort((a, b) => b.meanDamage - a.meanDamage)[0];
  const deadliestName = deadliest ? (hideEnemyNames ? t("AFoe") : deadliest.name) : null;
  const odds = oddsBand(win);
  const lines = [];

  switch ( accuracy ) {
    case "statistician": {
      lines.push(t("Stat.Odds", { win: pct(win, 1), lose: pct(lose, 1), stalemate: pct(results.pStalemate, 1) }));
      lines.push(t("Stat.Length", { median: rounds.median, p10: rounds.p10, p90: rounds.p90 }));
      lines.push(t("Stat.Death", { death: pct(death, 1), downed: pct(results.pAnyPcDowned, 1) }));
      for ( const c of Object.values(results.combatants).filter(x => x.side === SIDES.FRIENDLY) ) {
        lines.push(t("Stat.Member", { name: c.name, standing: pct(c.pStanding), dead: pct(c.pDead) }));
      }
      if ( deadliestName ) lines.push(t("Stat.Deadliest", { name: deadliestName, damage: deadliest.meanDamage.toFixed(1) }));
      if ( (results.pAnySwayed ?? 0) >= 0.01 ) lines.push(t("Stat.Talk", { p: pct(results.pAnySwayed, 1) }));
      break;
    }
    case "analyst": {
      lines.push(t("Analyst.Odds", { win: round5(win) }));
      lines.push(t("Analyst.Length", { p10: rounds.p10, p90: rounds.p90 }));
      const n = oneIn(death);
      lines.push(n && death >= 0.01 ? t("Analyst.Death", { n }) : t("Analyst.NoDeath"));
      if ( deadliestName ) lines.push(t("Analyst.Deadliest", { name: deadliestName }));
      if ( (results.pAnySwayed ?? 0) >= 0.05 ) lines.push(t("Analyst.Talk", { p: round5(results.pAnySwayed) }));
      break;
    }
    case "tactician": {
      lines.push(t(`Tactician.Odds.${odds}`));
      lines.push(t(`Tactician.Length.${lengthBand(rounds.median)}`));
      lines.push(t(`Tactician.Death.${deathBand(death)}`));
      if ( deadliestName ) lines.push(t("Tactician.Deadliest", { name: deadliestName }));
      if ( (results.pAnySwayed ?? 0) >= 0.15 ) lines.push(t("Tactician.Talk"));
      break;
    }
    case "roleplayer": {
      lines.push(t(`Roleplayer.${odds}`));
      break;
    }
    default: { // storyteller
      lines.push(t(`Story.Odds.${odds}`));
      const d = deathBand(death);
      if ( d !== "none" ) lines.push(t(`Story.Death.${d}`));
      lines.push(t(`Story.Length.${lengthBand(rounds.median)}`));
      if ( (results.pAnySwayed ?? 0) >= 0.15 ) lines.push(t("Story.Talk"));
    }
  }
  const title = t("Title");
  const report = { title, lines, accuracy };
  Hooks.callAll("fastFighting.prepareReport", report, { results, spec });
  report.html = renderReportHtml(report);
  return report;
}

export function renderReportHtml(report) {
  const esc = foundry.utils.escapeHTML ?? (s => s);
  return `<div class="fast-fighting-report">
    <header><i class="fa-solid fa-swords"></i> ${esc(report.title)}</header>
    ${report.lines.map(l => `<p>${esc(l)}</p>`).join("")}
  </div>`;
}

/** Post a report to chat. */
export async function sendReport(report, { mode = "public", whisperTo = [] } = {}) {
  const ChatMessage = foundry.documents.ChatMessage ?? globalThis.ChatMessage;
  const data = {
    content: renderReportHtml(report),
    speaker: { alias: game.i18n.localize("FASTFIGHTING.Report.Speaker") },
    flags: { [MODULE_ID]: { report: true, accuracy: report.accuracy } }
  };
  if ( mode === "whisper" ) {
    data.whisper = whisperTo.length ? whisperTo : game.users.filter(u => !u.isGM).map(u => u.id);
  }
  return ChatMessage.create(data);
}
