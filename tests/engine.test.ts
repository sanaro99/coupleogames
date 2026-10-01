import { describe, it, expect } from 'vitest';
import { createMatch, applyAction, viewMatch, pauseMatch, resumeMatch, tickMatch, normalize } from '../server/engine.js';
import type { GameAction, Seat } from '../shared/types.js';
import type { Match } from '../server/engine.js';
let sequence = 0;
const act = (m: Match, seat: Seat, type: GameAction['type'], rest: Partial<GameAction> = {}, now = 1000) => applyAction(m, seat, { id: String(++sequence), matchId: m.id, round: m.round, phase: m.phase, type, ...rest }, now);
describe('secret answers and fair scoring', () => {
  it('keeps the subject answer private until the guess is committed', () => {
    const m = createMatch('know', 1000); act(m, 0, 'answer', { choice: 2 });
    expect(viewMatch(m, 1).ownAnswer).toBeNull(); expect(viewMatch(m, 1).answer).toBeNull();
    expect(viewMatch(m, 1).partnerAnswered).toBe(true);
    act(m, 1, 'guess', { choice: 2 }); expect(m.scores).toEqual([0, 1]); expect(m.phase).toBe('reveal');
    expect(viewMatch(m, 1).reveal[0]).toBe(m.options[2]);
  });
  it('rejects overwritten, out of turn, stale and repeated submissions', () => {
    const m = createMatch('know', 1000);
    expect(() => act(m, 1, 'guess', { choice: 0 })).toThrow();
    act(m, 0, 'answer', { choice: 0 });
    expect(() => act(m, 0, 'answer', { choice: 1 })).toThrow();
    act(m, 1, 'guess', { choice: 0 });
    expect(() => act(m, 1, 'guess', { choice: 0, phase: 'play' })).toThrow();
    const oldRound = m.round; act(m, 0, 'next'); act(m, 1, 'next');
    expect(() => act(m, 1, 'answer', { choice: 0, round: oldRound })).toThrow();
    expect(m.scores).toEqual([0, 1]);
  });
  it('gives each partner three guesses and produces one final outcome', () => {
    const m = createMatch('know', 1000);
    for (let i = 0; i < 6; i++) {
      act(m, (i % 2) as Seat, 'answer', { choice: 0 }); act(m, ((i + 1) % 2) as Seat, 'guess', { choice: 0 });
      act(m, 0, 'next'); act(m, 1, 'next');
    }
    expect(m.phase).toBe('finished'); expect(m.scores).toEqual([3, 3]); expect(m.outcome?.winner).toBe('draw');
  });
  it('reveals simultaneous answers only after both commit and normalizes phrases', () => {
    const m = createMatch('sync', 1000); act(m, 0, 'answer', { text: ' Café! ' });
    expect(JSON.stringify(viewMatch(m, 1))).not.toContain('Café');
    expect(() => act(m, 0, 'answer', { text: 'changed' })).toThrow();
    act(m, 1, 'answer', { text: 'cafe' }); expect(m.scores[0]).toBe(1); expect(m.bestStreak).toBe(1);
    expect(normalize('  Ice--Cream!  ')).toBe('ice cream');
    expect(() => act(createMatch('sync', 1000), 0, 'answer', { text: '!!!' })).toThrow();
  });
});
describe('drawing deadlines and privacy', () => {
  it('sends the word only to the drawer, then reveals it after a correct guess', () => {
    const m = createMatch('doodle', 1000); expect(viewMatch(m, 1).prompt).toBe('Guess the drawing');
    expect(viewMatch(m, 1).answer).toBeNull(); act(m, 1, 'guess', { text: m.prompt });
    expect(m.phase).toBe('reveal'); expect(m.scores).toEqual([1, 1]); expect(viewMatch(m, 1).answer).toBe(m.prompt);
  });
  it('pauses the deadline and resumes with remaining time', () => {
    const m = createMatch('doodle', 1000); pauseMatch(m, 21000); expect(m.remainingMs).toBe(40000);
    tickMatch(m, 999000); expect(m.phase).toBe('play'); resumeMatch(m, 999000);
    expect(m.deadline).toBe(1039000); tickMatch(m, 1039000); expect(m.phase).toBe('reveal');
  });
  it('rejects guesses received at or after the deadline', () => {
    const m = createMatch('doodle', 1000);
    expect(() => act(m, 1, 'guess', { text: m.prompt }, 61000)).toThrow(); expect(m.scores).toEqual([0, 0]);
  });
  it('only lets the drawer draw and rejects off-canvas or oversized strokes', () => {
    const m = createMatch('doodle', 1000); const stroke = { color: '#26302d', width: 0.01, points: [{ x: 0.2, y: 0.3 }] };
    expect(() => act(m, 1, 'stroke', { stroke })).toThrow(); act(m, 0, 'stroke', { stroke });
    expect(viewMatch(m, 1).strokes).toHaveLength(1);
    expect(() => act(m, 0, 'stroke', { stroke: { ...stroke, points: [{ x: 20, y: 0 }] } })).toThrow();
  });
});
describe('cooperative clue turns', () => {
  it('keeps every target and trap inside the playable 12-tile board', () => {
    for (let n = 0; n < 30; n++) {
      const m = createMatch('clue', 1000);
      expect(m.keys).toHaveLength(m.words.length);
      expect(m.keys.filter(k => k === 'neutral')).toHaveLength(4);
    }
  });
  it('wins after six targets and loses after three neutral guesses', () => {
    const m = createMatch('clue', 1000);
    for (let turn = 0; turn < 2; turn++) {
      const giver = m.clueGiver; act(m, giver, 'clue', { text: 'cozy', count: 3 });
      for (const index of m.keys.map((k, i) => k === `target${giver}` ? i : -1).filter(i => i >= 0)) act(m, giver === 0 ? 1 : 0, 'tile', { choice: index });
    }
    expect(m.outcome).toEqual({ winner: 'together', success: true, score: 6 });
    const loss = createMatch('clue', 1000);
    const neutrals = loss.keys.map((k, i) => k === 'neutral' ? i : -1).filter(i => i >= 0);
    for (let i = 0; i < 3; i++) { const giver = loss.clueGiver; act(loss, giver, 'clue', { text: 'cozy', count: 1 }); act(loss, giver === 0 ? 1 : 0, 'tile', { choice: neutrals[i] }); }
    expect(loss.lives).toBe(0); expect(loss.outcome?.success).toBe(false);
  });
  it('hides the other partner targets and all unrevealed trap labels', () => {
    const m = createMatch('clue', 1000); const v = viewMatch(m, 0);
    expect(v.board.filter(t => t.yourTarget)).toHaveLength(3);
    expect(v.board.every(t => t.status === 'hidden')).toBe(true);
    expect(v.board[m.keys.indexOf('target1')].yourTarget).toBe(false);
  });
  it('allows only the designated clue giver, then only the guesser', () => {
    const m = createMatch('clue', 1000);
    expect(() => act(m, 1, 'clue', { text: 'cozy', count: 1 })).toThrow();
    expect(() => act(m, 0, 'clue', { text: m.words[0], count: 1 })).toThrow();
    act(m, 0, 'clue', { text: 'cozy', count: 1 });
    expect(() => act(m, 0, 'tile', { choice: 0 })).toThrow();
    act(m, 1, 'tile', { choice: m.keys.indexOf('target0') }); expect(m.found).toBe(1); expect(m.clueGiver).toBe(1);
  });
  it('ends the quest on a trap and never allows a second result', () => {
    const m = createMatch('clue', 1000); act(m, 0, 'clue', { text: 'cozy', count: 2 });
    act(m, 1, 'tile', { choice: m.keys.indexOf('trap') }); expect(m.phase).toBe('finished'); expect(m.outcome?.success).toBe(false);
    expect(() => act(m, 1, 'tile', { choice: 0 })).toThrow();
  });
});
