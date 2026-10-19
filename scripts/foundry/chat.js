/** What every part of FastFighting that posts to the chat shares. */

/** Foundry's ChatMessage class. */
export const chatMessageClass = () => foundry.documents.ChatMessage ?? globalThis.ChatMessage;

/** Every GM's user id: whom a card for the GMs alone is whispered to. */
export const gmIds = () => game.users.filter(u => u.isGM).map(u => u.id);
