import { randomInt, randomUUID } from 'node:crypto';
import { CLUE_WORDS, DRAW_WORDS, QUESTIONS, SYNC_PROMPTS } from './content.js';
import { otherSeat } from '../shared/types.js';
import type { GameId, GameAction, GameView, Outcome, Phase, Seat, Stroke } from '../shared/types.js';
type Key = 'target0' | 'target1' | 'neutral' | 'trap';
export interface Match {
  id: string; game: GameId; phase: Phase; round: number; totalRounds: number;
  scores: [number, number]; ready: [boolean, boolean]; paused: boolean;
  deadline: number | null; remainingMs: number; outcome: Outcome | null;
  prompt: string; options: string[]; answers: [string | null, string | null]; deck: number[];
  strokes: Stroke[]; guesses: string[]; matched: boolean | null; streak: number; bestStreak: number;
  words: string[]; keys: Key[]; revealed: boolean[]; clueGiver: Seat; cluePhase: 'clue' | 'guess';
  clue: string | null; clueCount: number; guessesLeft: number; turn: number; lives: number; found: number; actionIds: string[];
}
const fail = (message: string): never => { throw new Error(message); };
export const normalize = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
function shuffle<T>(items: T[]): T[] {
  const values = [...items];
  for (let i = values.length - 1; i > 0; i--) { const j = randomInt(i + 1); [values[i], values[j]] = [values[j], values[i]]; }
  return values;
}
function beginRound(m: Match, now: number) {
  m.phase = 'play'; m.ready = [false, false]; m.answers = [null, null]; m.strokes = []; m.guesses = []; m.matched = null;
  const index = m.deck[m.round];
  if (m.game === 'doodle') { m.prompt = DRAW_WORDS[index]; m.remainingMs = 60000; m.deadline = m.paused ? null : now + 60000; }
  if (m.game === 'know') { m.prompt = QUESTIONS[index].prompt; m.options = QUESTIONS[index].options; }
  if (m.game === 'sync') m.prompt = SYNC_PROMPTS[index];
}
export function createMatch(game: GameId, now: number): Match {
  const source = game === 'doodle' ? DRAW_WORDS : game === 'know' ? QUESTIONS : SYNC_PROMPTS;
  const m: Match = {
    id: randomUUID(), game, phase: 'play', round: 0, totalRounds: game === 'clue' ? 8 : 6,
    scores: [0, 0], ready: [false, false], paused: false, deadline: null, remainingMs: 0, outcome: null,
    prompt: '', options: [], answers: [null, null], deck: shuffle(source.map((_, i) => i)).slice(0, 6),
    strokes: [], guesses: [], matched: null, streak: 0, bestStreak: 0,
    words: [], keys: [], revealed: [], clueGiver: 0, cluePhase: 'clue', clue: null,
    clueCount: 0, guessesLeft: 0, turn: 1, lives: 3, found: 0, actionIds: [],
  };
  if (game === 'clue') {
    m.words = shuffle(CLUE_WORDS).slice(0, 12); m.keys = shuffle<Key>(['target0', 'target0', 'target0', 'target1', 'target1', 'target1', 'neutral', 'neutral', 'neutral', 'neutral', 'trap', 'trap']);
    m.revealed = Array(12).fill(false); m.prompt = 'Find your six treasures together';
  } else beginRound(m, now);
  return m;
}
function finish(m: Match, success?: boolean) {
  m.phase = 'finished'; m.deadline = null; m.paused = false;
  if (m.game === 'know') m.outcome = { winner: m.scores[0] === m.scores[1] ? 'draw' : m.scores[0] > m.scores[1] ? 0 : 1, score: Math.max(...m.scores), success: true };
  else { const won = success ?? m.scores[0] >= 3; m.outcome = { winner: won ? 'together' : 'none', score: m.game === 'clue' ? m.found : m.scores[0], success: won }; }
}
function reveal(m: Match) { m.phase = 'reveal'; m.ready = [false, false]; m.deadline = null; }
function nextClueTurn(m: Match) {
  if (m.turn >= 8 || m.lives <= 0) { finish(m, false); return; }
  m.turn++; m.round++; m.clueGiver = otherSeat(m.clueGiver); m.cluePhase = 'clue'; m.clue = null; m.guessesLeft = 0;
}
function answerText(text?: string): string {
  if (typeof text !== 'string' || text.length > 100 || !normalize(text)) fail('Use a word or short phrase (up to 100 characters).');
  return text!.trim();
}
function choiceIndex(choice: number | undefined, max: number): number {
  if (choice === undefined || !Number.isInteger(choice) || choice < 0 || choice >= max) fail('Choose one of the available options.');
  return choice!;
}
export function applyAction(m: Match, seat: Seat, a: GameAction, now: number): void {
  tickMatch(m, now);
  if (a.matchId !== m.id || a.round !== m.round || a.phase !== m.phase) fail('The round has changed. Please try again.');
  if (m.phase === 'finished') fail('This match has finished.');
  if (m.actionIds.includes(a.id)) fail('That action was already received.');
  if (m.paused && m.phase === 'play') fail('Waiting for both partners to reconnect.');
  if (a.type === 'next') {
    if (m.phase !== 'reveal' || m.ready[seat]) fail('Already ready, or this round is still in play.');
    m.ready[seat] = true;
    if (m.ready.every(Boolean)) { if (m.round === 5) finish(m); else { m.round++; beginRound(m, now); } }
  } else {
    if (m.phase !== 'play') fail('The answers are already revealed.');
    if (m.game === 'doodle') applyDoodle(m, seat, a);
    else if (m.game === 'know') applyKnow(m, seat, a);
    else if (m.game === 'sync') applySync(m, seat, a);
    else applyClue(m, seat, a);
  }
  m.actionIds.push(a.id); if (m.actionIds.length > 256) m.actionIds.shift();
}
function applyDoodle(m: Match, seat: Seat, a: GameAction) {
  const drawer = (m.round % 2) as Seat;
  if (a.type === 'guess') {
    if (seat === drawer) fail('Your partner is guessing this round.');
    const guess = answerText(a.text); m.guesses.push(guess); if (m.guesses.length > 20) m.guesses.shift();
    if (normalize(guess) === normalize(m.prompt)) { m.scores[0]++; m.scores[1]++; m.matched = true; reveal(m); }
  } else if (a.type === 'stroke') {
    if (seat !== drawer) fail('Only the drawer can draw.'); const s = a.stroke;
    if (!s || !/^#[0-9a-f]{6}$/i.test(s.color) || s.width < .002 || s.width > .06 || !s.points.length || s.points.length > 300 || s.points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) fail('That drawing stroke is not valid.');
    if (m.strokes.reduce((n, s) => n + s.points.length, 0) + s!.points.length > 15000) fail('The canvas is full. Clear it to keep drawing.');
    m.strokes.push(structuredClone(s!));
  } else if (a.type === 'clear' && seat === drawer) m.strokes = [];
  else fail('That action is not available right now.');
}
function applyKnow(m: Match, seat: Seat, a: GameAction) {
  const subject = (m.round % 2) as Seat;
  if (m.answers[seat] !== null) fail('Your answer is already locked.');
  if (a.type === 'answer' && seat === subject) m.answers[seat] = String(choiceIndex(a.choice, 4));
  else if (a.type === 'guess' && seat !== subject && m.answers[subject] !== null) {
    m.answers[seat] = String(choiceIndex(a.choice, 4)); m.matched = m.answers[0] === m.answers[1];
    if (m.matched) m.scores[seat]++; reveal(m);
  } else fail('Wait for your partner to lock in their own answer.');
}
function applySync(m: Match, seat: Seat, a: GameAction) {
  if (a.type !== 'answer' || m.answers[seat] !== null) fail('Your answer is already locked, or this action is unavailable.');
  m.answers[seat] = answerText(a.text);
  if (m.answers.every(v => v !== null)) {
    m.matched = normalize(m.answers[0]!) === normalize(m.answers[1]!);
    if (m.matched) { m.scores[0]++; m.scores[1]++; m.streak++; m.bestStreak = Math.max(m.bestStreak, m.streak); } else m.streak = 0;
    reveal(m);
  }
}
function applyClue(m: Match, seat: Seat, a: GameAction) {
  if (a.type === 'clue') {
    if (seat !== m.clueGiver || m.cluePhase !== 'clue') fail('It is your partner’s clue turn.');
    const word = answerText(a.text);
    if (!/^\p{L}+$/u.test(word) || m.words.some(v => normalize(v) === normalize(word))) fail('Use one word that is not on the board.');
    if (!Number.isInteger(a.count) || a.count! < 1 || a.count! > 3) fail('Choose 1, 2 or 3 tiles.');
    m.clue = word; m.clueCount = a.count!; m.guessesLeft = a.count!; m.cluePhase = 'guess';
  } else if (seat !== m.clueGiver && m.cluePhase === 'guess') {
    if (a.type === 'endturn') { nextClueTurn(m); return; }
    if (a.type !== 'tile') fail('Choose a tile or end your guessing turn.');
    const index = choiceIndex(a.choice, 12); if (m.revealed[index]) fail('That tile is already revealed.'); m.revealed[index] = true;
    if (m.keys[index] === 'trap') finish(m, false);
    else if (m.keys[index] === 'neutral') { m.lives--; nextClueTurn(m); }
    else {
      m.found++; m.scores = [m.found, m.found]; m.guessesLeft--;
      if (m.found === 6) finish(m, true); else if (m.guessesLeft <= 0) nextClueTurn(m);
    }
  } else fail('Wait for the clue, or for your partner to guess.');
}
export function pauseMatch(m: Match, now: number): void {
  if (m.paused || m.phase === 'finished') return;
  if (m.deadline !== null) m.remainingMs = Math.max(0, m.deadline - now); m.deadline = null; m.paused = true;
}
export function resumeMatch(m: Match, now: number): void {
  if (!m.paused) return; m.paused = false;
  if (m.game === 'doodle' && m.phase === 'play') m.deadline = now + m.remainingMs;
}
export function tickMatch(m: Match, now: number): boolean {
  if (m.game === 'doodle' && m.phase === 'play' && !m.paused && m.deadline !== null && now >= m.deadline) { m.remainingMs = 0; m.matched = false; reveal(m); return true; }
  return false;
}
export function viewMatch(m: Match, seat: Seat): GameView {
  const revealed = m.phase !== 'play'; const subject = (m.round % 2) as Seat;
  const displayed = (s: Seat) => m.answers[s] === null ? null : m.game === 'know' ? m.options[Number(m.answers[s])] : m.answers[s];
  return {
    id: m.id, game: m.game, phase: m.phase, round: m.round, totalRounds: m.totalRounds,
    scores: [...m.scores], ready: [...m.ready], paused: m.paused, deadline: m.deadline, remainingMs: m.remainingMs, outcome: m.outcome,
    prompt: m.game === 'doodle' && seat !== subject && !revealed ? 'Guess the drawing' : m.prompt,
    options: m.options, answer: m.game === 'doodle' && revealed ? m.prompt : null,
    ownAnswer: displayed(seat), partnerAnswered: m.answers[otherSeat(seat)] !== null,
    subject, drawer: subject, strokes: m.strokes, guesses: m.guesses,
    reveal: revealed ? [displayed(0), displayed(1)] : [null, null], matched: m.matched,
    streak: m.streak, bestStreak: m.bestStreak,
    board: m.words.map((word, i) => ({ word, status: m.revealed[i] || m.phase === 'finished' ? m.keys[i].startsWith('target') ? 'target' : m.keys[i] as 'neutral' | 'trap' : 'hidden', yourTarget: m.keys[i] === `target${seat}` })),
    clueGiver: m.clueGiver, cluePhase: m.cluePhase, clue: m.clue, clueCount: m.clueCount,
    guessesLeft: m.guessesLeft, turn: m.turn, lives: m.lives, found: m.found,
  };
}
