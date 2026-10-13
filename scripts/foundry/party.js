/**
 * The party's wishes: how the players want everyone on their side to act, voted in the survey's Party tab. One vote
 * per player (not per character) on each question, kept on the player's own User (flags.fast-fighting.party); every
 * player sees everyone's votes. Majority rules: a question's most-voted answer is the party's (a tie, none). In a fight
 * the party's answers sway everyone on the friendly side by the world's Party's sway (engine/behavior/desire.js
 * partyWants for what they want; engine/playstyles.js sampleRunTactics for how they act).
 */
import { MODULE_ID } from "../constants.js";
import { localize } from "../i18n.js";

/** The questions and their answers (pills). */
export const PARTY_QUESTIONS = Object.freeze({
  target: Object.freeze(["nearest", "weakest", "dangerous", "casters", "leader"]),
  talk: Object.freeze(["first", "opportune", "never"]),
  fallen: Object.freeze(["finish", "leave", "spare"]),
  care: Object.freeze(["heal", "guard", "self"]),
  resources: Object.freeze(["conserve", "balanced", "nova"]),
  retreat: Object.freeze(["never", "losing", "hurt"])
});

/** The tactics questions a party answer stands for, where a character leaves them to "Let this character decide". */
export const PARTY_TACTICS = Object.freeze({
  talk: { talk: { first: "first", opportune: "opportune", never: "never" } },
  resources: {
    resourceUse: { conserve: "conserve", balanced: "balanced", nova: "nova" },
    consumables: { conserve: "sparing", balanced: "useful", nova: "freely" }
  },
  retreat: { retreat: { never: "never", losing: "losing", hurt: "hurt" } }
});

/** A player's votes, as stored (only answers the questions have). */
export function votesOf(user) {
  const raw = user?.getFlag?.(MODULE_ID, "party");
  const out = {};
  if ( !raw || typeof raw !== "object" ) return out;
  for ( const [q, answers] of Object.entries(PARTY_QUESTIONS) ) if ( answers.includes(raw[q]) ) out[q] = raw[q];
  return out;
}

/**
 * The party's answers: each question's most-voted answer (majority rules; a tie, or no votes, none).
 * @param {object[]} ballots   each player's votes ({question: answer})
 * @returns {Record<string, string>}
 */
export function majority(ballots) {
  const out = {};
  for ( const [q, answers] of Object.entries(PARTY_QUESTIONS) ) {
    const tally = new Map();
    for ( const b of ballots ) if ( answers.includes(b?.[q]) ) tally.set(b[q], (tally.get(b[q]) ?? 0) + 1);
    const ranked = [...tally].sort((a, b) => b[1] - a[1]);
    if ( ranked.length && (ranked.length === 1 || ranked[0][1] > ranked[1][1]) ) out[q] = ranked[0][0];
  }
  return out;
}

/** The players who vote: everyone but the GMs. */
export const voters = () => (game.users ?? []).filter(u => !u.isGM);

/** Vote (or, voting the same again, take the vote back). */
export async function castVote(question, answer) {
  if ( game.user.isGM || !PARTY_QUESTIONS[question]?.includes(answer) ) return;
  const mine = votesOf(game.user);
  if ( mine[question] === answer ) await game.user.unsetFlag(MODULE_ID, `party.${question}`);
  else await game.user.setFlag(MODULE_ID, `party.${question}`, answer);
}

/**
 * The party's wishes for a fight: the majority answers of the players with a character in it (everyone's, when none
 * has voted), and how much they sway (the world's Party's sway, as a share). Null when there are none.
 * @param {User[]} players   whose votes count
 * @param {number} swayPercent
 */
export function partyWishes(players, swayPercent) {
  const answers = majority(players.map(votesOf));
  if ( !Object.keys(answers).length ) return null;
  return { ...answers, sway: Math.max(0, Number(swayPercent) || 0) / 100 };
}

/** The survey's Party tab: each question's pills, with every player's vote on them as a dot in the player's color. */
export function partyContext() {
  const players = voters();
  const ballots = players.map(u => [u, votesOf(u)]);
  const answers = majority(ballots.map(([, b]) => b));
  const mine = votesOf(game.user);
  const label = (q, k) => localize(`FASTFIGHTING.Party.${q}.${k}`);
  return {
    canVote: !game.user.isGM,
    questions: Object.entries(PARTY_QUESTIONS).map(([q, options]) => ({
      key: q,
      label: label(q, "Label"),
      hint: label(q, "Hint"),
      options: options.map(o => ({
        value: o,
        label: label(q, o),
        mine: mine[q] === o,
        winning: answers[q] === o,
        voters: ballots.filter(([, b]) => b[q] === o).map(([u]) => ({ name: u.name, initial: [...(u.name ?? "?")][0]?.toLocaleUpperCase() ?? "?", color: u.color?.css ?? String(u.color ?? "#888") }))
      }))
    }))
  };
}
