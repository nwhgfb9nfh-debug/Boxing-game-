// Persistent player stats (Section 5): Fame, Image, Money, and the HP
// buffer banked from leftover Energy Star. Relationship-per-NPC isn't
// here yet — that needs contacts, which come with the meetup/new-people
// actions in a later Private Life piece.

export interface PlayerState {
  fame: number;
  image: number;
  money: number;
  hpBuffer: number; // banked insurance from leftover Energy Star at sleep time
}

export function createPlayerState(): PlayerState {
  return { fame: 0, image: 0, money: 0, hpBuffer: 0 };
}
