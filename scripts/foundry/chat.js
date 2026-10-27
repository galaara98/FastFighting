/** What every part of FastFighting that posts to the chat shares. */

/** Foundry's ChatMessage class. */
export const chatMessageClass = () => foundry.documents.ChatMessage ?? globalThis.ChatMessage;

/** Every GM's user id: whom a card for the GMs alone is whispered to. */
export const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);

/**
 * The GM a player's browser asks about a battle's card (`authorId`, its author's: the GM whose browser plays the
 * battle), while they're here; else the active GM. `users`: Foundry's (game.users).
 */
export function cardGm(users, authorId) {
  const author = typeof authorId === "string" ? users.get(authorId) : null;
  return author?.isGM && author.active ? author : users.activeGM ?? null;
}
