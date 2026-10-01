export type Seat = 0 | 1;
export type GameId = 'doodle' | 'know' | 'sync' | 'clue';
export type Phase = 'play' | 'reveal' | 'finished';
export type CatMood = 'welcome' | 'explain' | 'think' | 'celebrate' | 'sleep' | 'walk' | 'leave';
export interface Point { x: number; y: number }
export interface Stroke { color: string; width: number; points: Point[] }
export interface Outcome { winner: Seat | 'together' | 'draw' | 'none'; score: number; success: boolean }
export interface GameAction {
  id: string; matchId: string; round: number; phase: Phase;
  type: 'answer' | 'guess' | 'stroke' | 'clear' | 'next' | 'clue' | 'tile' | 'endturn';
  text?: string; choice?: number; count?: number; stroke?: Stroke;
}
export interface TileView { word: string; status: 'hidden' | 'target' | 'neutral' | 'trap'; yourTarget: boolean }
export interface GameView {
  id: string; game: GameId; phase: Phase; round: number; totalRounds: number;
  scores: [number, number]; ready: [boolean, boolean]; paused: boolean;
  deadline: number | null; remainingMs: number; outcome: Outcome | null;
  prompt: string; options: string[]; answer: string | null; ownAnswer: string | null;
  partnerAnswered: boolean; subject: Seat; drawer: Seat; strokes: Stroke[];
  guesses: string[]; reveal: [string | null, string | null]; matched: boolean | null;
  streak: number; bestStreak: number; board: TileView[]; clueGiver: Seat;
  cluePhase: 'clue' | 'guess'; clue: string | null; clueCount: number;
  guessesLeft: number; turn: number; lives: number; found: number;
}
export interface RecordEntry {
  id: string; game: GameId; finishedAt: number; outcome: Outcome;
  scores: [number, number]; bestStreak: number;
}
export interface Proposal { id: string; game: GameId; ready: [boolean, boolean] }
export interface RoomState {
  seat: Seat; names: [string, string]; setup: boolean; online: [boolean, boolean];
  proposal: Proposal | null; match: GameView | null; records: RecordEntry[];
  leaveVotes: [boolean, boolean]; serverTime: number;
}
export const otherSeat = (seat: Seat): Seat => seat === 0 ? 1 : 0;
