export const NOTES_PER_SPIRIT_SWORD = 10;
export const MAX_SPIRIT_SWORDS = 15;

export function getSpiritSwordCount(noteCount: number) {
  if (!Number.isFinite(noteCount) || noteCount <= 0) return 0;
  return Math.min(Math.floor(noteCount / NOTES_PER_SPIRIT_SWORD), MAX_SPIRIT_SWORDS);
}
