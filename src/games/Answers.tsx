import { useState } from 'react';
import { Check, LockKeyhole } from 'lucide-react';
import type { GameView, RoomState } from '../../shared/types';
import type { Act } from '../hooks/useRoom';
export function Answers({ m, room, act }: { m: GameView; room: RoomState; act: Act }) {
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
  const subject = room.seat === m.subject; const locked = m.ownAnswer !== null;
  const partner = room.names[room.seat === 0 ? 1 : 0];
  const waitingForSubject = m.game === 'know' && !subject && !m.partnerAnswered;
  const blocked = locked || waitingForSubject || m.paused;
  return <div className="answers-game">
    <div className="prompt-card" data-cat-anchor="prompt"><h2>{m.prompt}</h2>{m.game === 'know' && <p>{subject ? 'Pick your answer.' : waitingForSubject ? `Waiting for ${room.names[m.subject]} to choose.` : `What would ${room.names[m.subject]} pick?`}</p>}</div>
    {locked ? <div className="locked-answer"><LockKeyhole size={20} /><p>{m.ownAnswer}</p><small>Waiting for {partner}</small></div>
      : m.game === 'know' ? <div className="answer-options">{m.options.map((option, i) => <button key={option} className="answer-option" disabled={blocked || busy} onClick={async () => { setBusy(true); await act({ type: subject ? 'answer' : 'guess', choice: i }); setBusy(false); }}><span>{String.fromCharCode(65 + i)}</span>{option}<Check size={17} /></button>)}</div>
      : <form className="answer-form" onSubmit={async e => { e.preventDefault(); setBusy(true); await act({ type: 'answer', text }); setBusy(false); }}><label htmlFor="secret-answer">Your answer</label><input id="secret-answer" autoComplete="off" maxLength={100} value={text} onChange={e => setText(e.target.value)} disabled={blocked} /><button className="primary" disabled={blocked || busy || !text.trim()}><LockKeyhole size={16} /> Submit answer</button></form>}
  </div>;
}
