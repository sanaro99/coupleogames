import { ArrowLeft, ArrowRight, CircleHelp, Flag, Trophy } from 'lucide-react';
import { GAMES } from '../../shared/games';
import { otherSeat, type RoomState } from '../../shared/types';
import type { Act } from '../hooks/useRoom';
import { Answers } from './Answers';
import { Clue } from './Clue';
import { Doodle } from './Doodle';
export function GamePanel({ room, act, send, rules, effects }: { room: RoomState; act: Act; send: (event: string, value?: unknown) => Promise<boolean>; rules: () => void; effects: boolean }) {
  const m = room.match!; const game = GAMES[m.game]; const partner = otherSeat(room.seat);
  const resultTitle = m.outcome?.winner === 'together' ? 'You won' : m.outcome?.winner === 'draw' ? 'Draw' : m.outcome?.winner === 'none' ? 'Game over' : m.outcome ? `${room.names[m.outcome.winner as 0 | 1]} won` : '';
  return <section className="game-panel">
    <div className="game-heading" data-cat-anchor="game"><div><h1>{game.title}</h1><p className="match-round">{m.game === 'clue' ? `Turn ${m.turn} of 8` : `Round ${m.round + 1} of 6`}</p></div><button className="icon-button" aria-label="Game rules" onClick={rules}><CircleHelp size={22} /></button></div>
    <div className="match-score">{m.game === 'know' ? room.names.map((name, s) => <span key={s}><i className={`seat-dot partner-${s}`} />{name}<strong>{m.scores[s]}</strong></span>) : <span>Score <strong>{m.game === 'clue' ? m.found : m.scores[0]}/6</strong></span>}</div>
    {m.paused && m.phase !== 'finished' && <div className="pause-note" role="status">Paused. Waiting for {room.names[partner]} to reconnect.</div>}
    {m.phase === 'finished' ? <div className="result-card" data-cat-anchor="result"><Trophy size={32} className="result-trophy" /><h2>{resultTitle}</h2>{m.game !== 'know' ? <p>{m.outcome?.score}/6 {m.game === 'doodle' ? 'words guessed' : m.game === 'sync' ? 'matching answers' : 'targets found'}</p> : <p>{room.names[0]} {m.scores[0]} · {room.names[1]} {m.scores[1]}</p>}<button className="primary" onClick={() => void send('propose', { game: m.game })}>Play again <ArrowRight size={17} /></button><button className="text-button" onClick={() => void send('lobby', { matchId: m.id })}><ArrowLeft size={16} /> Games</button></div>
      : m.phase === 'reveal' ? <div className={`reveal-card ${m.matched ? 'matched' : ''}`} data-cat-anchor="reveal">
        {m.game === 'doodle' ? <><p className="reveal-status">{m.matched ? 'Correct' : 'Time’s up'}</p><span className="answer-label">Answer</span><p className="revealed-word">{m.answer}</p></>
          : <><p className="reveal-status">{m.game === 'sync' ? m.matched ? 'Same answer' : 'Different answers' : m.matched ? 'Correct' : 'Incorrect'}</p><div className="revealed-answers">{room.names.map((name, s) => <div key={s}><span>{name}</span><strong>{m.reveal[s]}</strong></div>)}</div></>}
        {m.game === 'sync' && m.streak > 1 && <p className="muted">{m.streak} in a row</p>}
        <button className="primary" disabled={m.ready[room.seat]} onClick={() => void act({ type: 'next' })}>{m.ready[room.seat] ? `Waiting for ${room.names[partner]}` : m.round === 5 ? 'See result' : 'Next round'}<ArrowRight size={16} /></button>
      </div> : m.game === 'doodle' ? <Doodle key={`${m.id}-${m.round}`} m={m} room={room} act={act} /> : m.game === 'clue' ? <Clue key={`${m.id}-${m.round}`} m={m} room={room} act={act} effects={effects} /> : <Answers key={`${m.id}-${m.round}`} m={m} room={room} act={act} />}
    {m.phase !== 'finished' && <div className="leave-match">{room.leaveVotes[partner] && <p>{room.names[partner]} wants to leave this match.</p>}<button className="text-button" onClick={() => void send('leave', { matchId: m.id })}><Flag size={14} />{room.leaveVotes[room.seat] ? 'Cancel request' : room.leaveVotes[partner] ? 'Leave together' : 'Leave match'}</button>{room.leaveVotes[room.seat] && <small>Waiting for {room.names[partner]} to agree.</small>}</div>}
  </section>;
}
