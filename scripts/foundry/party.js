/**
 * The party's wishes: how the players want everyone on their side to act, voted in the survey's Party tab. One vote
 * per player (not per character) on each question, kept on the player's own User (flags.fast-fighting.party); every
 * player sees everyone's votes. Only the votes of players logged in count (a vote waits on its User for its player to
 * be back). Majority rules: a question's most-voted answer is the party's; a tie goes to the party's leader (the answer
 * its player voted for), and a tie the leader doesn't settle is no answer, as if nobody had voted. In a fight
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

/**
 * Where a player stands in the party's vote: the round (the GM's last survey sent to everyone), whether it has locked
 * its choices in for that round, and whether it can vote now (the round's survey still open, not locked in). Kept on
 * the player's User: survey.partyRound and survey.partyOpen (written by the GM's request, closed when the player
 * closes the survey) and partyLock (the round it locked in).
 * @returns {{round: string|null, locked: boolean, open: boolean}}
 */
export function partyState(user = game.user) {
  const survey = user?.getFlag?.(MODULE_ID, "survey");
  const round = typeof survey?.partyRound === "string" ? survey.partyRound : null;
  const locked = !!round && user.getFlag(MODULE_ID, "partyLock") === round;
  return { round, locked, open: !!round && survey.partyOpen === true && !locked && !user.isGM };
}

/** Lock the player's choices in for this round: no more voting until the GM sends everyone a new survey. */
export async function lockInParty() {
  const { round, open } = partyState(game.user);
  if ( !open ) return;
  await game.user.update({ [`flags.${MODULE_ID}.partyLock`]: round, [`flags.${MODULE_ID}.survey.partyOpen`]: false });
}

/** A player's votes, as stored (only answers the questions have). */
export function votesOf(user) {
  const raw = user?.getFlag?.(MODULE_ID, "party");
  const out = {};
  if ( !raw || typeof raw !== "object" ) return out;
  for ( const [q, answers] of Object.entries(PARTY_QUESTIONS) ) if ( answers.includes(raw[q]) ) out[q] = raw[q];
  return out;
}

/**
 * The party's answers: each question's most-voted answer (majority rules). A tie goes to the leader: the one of the
 * tied answers its players voted for (just one of them); else it's no answer, as if nobody had voted.
 * @param {object[]} ballots     each player's votes ({question: answer})
 * @param {object[]} [leader]    the votes of the leader's players (among the ballots)
 * @returns {Record<string, string>}
 */
export function majority(ballots, leader = []) {
  const out = {};
  for ( const [q, answers] of Object.entries(PARTY_QUESTIONS) ) {
    const tally = new Map();
    for ( const b of ballots ) if ( answers.includes(b?.[q]) ) tally.set(b[q], (tally.get(b[q]) ?? 0) + 1);
    const most = Math.max(0, ...tally.values());
    const top = [...tally].filter(([, n]) => n === most).map(([a]) => a);
    if ( top.length === 1 ) out[q] = top[0];
    else if ( top.length > 1 ) {
      const theirs = [...new Set(leader.map(b => b?.[q]).filter(a => top.includes(a)))];
      if ( theirs.length === 1 ) out[q] = theirs[0];
    }
  }
  return out;
}

/** The players who vote: everyone but the GMs, logged in now. */
export const voters = () => (game.users ?? []).filter(u => !u.isGM && u.hasRole?.("PLAYER") && u.active);

/** Vote (or, voting the same again, take the vote back). */
export async function castVote(question, answer) {
  if ( !partyState(game.user).open || !PARTY_QUESTIONS[question]?.includes(answer) ) return;
  const mine = votesOf(game.user);
  if ( mine[question] === answer ) await game.user.unsetFlag(MODULE_ID, `party.${question}`);
  else await game.user.setFlag(MODULE_ID, `party.${question}`, answer);
}

/**
 * The party's wishes for a fight: the majority answers of the players with a character in it (a tie, the leader's
 * players' say), and how much they sway (the world's Party's sway, as a share). Null when there are none.
 * @param {User[]} players   whose votes count
 * @param {number} swayPercent
 * @param {User[]} [leaders] the party leader's players (who settle a tie)
 */
export function partyWishes(players, swayPercent, leaders = []) {
  const answers = majority(players.map(votesOf), leaders.filter(u => players.includes(u)).map(votesOf));
  if ( !Object.keys(answers).length ) return null;
  return { ...answers, sway: Math.max(0, Number(swayPercent) || 0) / 100 };
}

/**
 * The survey's Party tab: each question's pills, with every player's vote on them as a dot in the player's color (the
 * players logged in: their votes are the ones that count). The player votes while its round is open (partyState); else
 * it's there to look at.
 */
export function partyContext() {
  const state = partyState(game.user);
  const players = voters();
  const ballots = players.map(u => [u, votesOf(u)]);
  const answers = majority(ballots.map(([, b]) => b));
  const mine = votesOf(game.user);
  const label = (q, k) => localize(`FASTFIGHTING.Party.${q}.${k}`);
  return {
    canVote: state.open,
    locked: state.locked,
    readOnly: !game.user.isGM && !state.open && !state.locked,
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
