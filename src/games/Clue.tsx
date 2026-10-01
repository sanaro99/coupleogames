import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import { Gem, Heart } from 'lucide-react';
import type { GameView, RoomState } from '../../shared/types';
import type { Act } from '../hooks/useRoom';
const ClueScene = lazy(() => import('./ClueScene'));
class BoardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }; static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}
export function Clue({ m, room, act, effects }: { m: GameView; room: RoomState; act: Act; effects: boolean }) {
  const [text, setText] = useState(''); const [count, setCount] = useState('1'); const [busy, setBusy] = useState(false);
  const giver = room.seat === m.clueGiver; const guessing = m.cluePhase === 'guess';
  return <div className="clue-game"><div className="quest-status"><span><Gem size={16} /> {m.found}/6 targets</span><span><Heart size={16} /> {m.lives} lives</span><span>Turn {m.turn}/8</span></div>
    <div className="clue-instruction" data-cat-anchor="prompt">{guessing ? <h2>{m.clue} <span>· {m.clueCount}</span></h2> : <p>{giver ? 'Give a clue for your marked words.' : `Waiting for ${room.names[m.clueGiver]}’s clue.`}</p>}{guessing && <p>{giver ? `${room.names[room.seat === 0 ? 1 : 0]} is guessing.` : `${m.guessesLeft} ${m.guessesLeft === 1 ? 'guess' : 'guesses'} left`}</p>}</div>
    <div className="clue-board">{effects && <div className="board-scene"><BoardBoundary><Suspense fallback={null}><ClueScene board={m.board} /></Suspense></BoardBoundary></div>}<div className="word-grid">{m.board.map((tile, i) => <button className={`word-tile ${tile.status} ${tile.yourTarget && tile.status === 'hidden' ? 'your-target' : ''}`} key={tile.word} aria-label={tile.word} disabled={giver || !guessing || tile.status !== 'hidden' || m.paused || busy} onClick={async () => { setBusy(true); await act({ type: 'tile', choice: i }); setBusy(false); }}>{tile.word}{tile.yourTarget && tile.status === 'hidden' && <span className="target-mark" aria-hidden="true">✦</span>}</button>)}</div></div>
    <div className="board-legend"><span><i /> Your targets</span><span><i /> Found</span></div>
    {giver && !guessing ? <form className="clue-form" onSubmit={async e => { e.preventDefault(); setBusy(true); if (await act({ type: 'clue', text, count: Number(count) })) setText(''); setBusy(false); }}><div><label className="sr-only" htmlFor="clue">Your one-word clue</label><input id="clue" value={text} onChange={e => setText(e.target.value)} maxLength={40} placeholder="Clue" autoComplete="off" disabled={m.paused} /></div><label className="sr-only" htmlFor="count">Number of tiles</label><select id="count" value={count} onChange={e => setCount(e.target.value)} disabled={m.paused}><option>1</option><option>2</option><option>3</option></select><button className="primary" disabled={m.paused || busy || !text.trim()}>Send clue</button></form>
      : !giver && guessing ? <button className="secondary end-turn" disabled={m.paused || busy} onClick={() => void act({ type: 'endturn' })}>End guessing turn</button> : null}
  </div>;
}
