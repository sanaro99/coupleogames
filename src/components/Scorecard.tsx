import { GAMES } from '../../shared/games';
import type { GameId, RoomState, Seat } from '../../shared/types';
export function Scorecard({ room }: { room: RoomState }) {
  const rivalry = room.records.filter(r => r.game === 'know'); const joint = room.records.filter(r => r.game !== 'know');
  const wins = (seat: Seat) => rivalry.filter(r => r.outcome.winner === seat).length;
  const streak = (seat: Seat) => { let n = 0; for (const r of rivalry) { if (r.outcome.winner !== seat) break; n++; } return n; };
  return <div className="scorecard">
    <div className="score-overview"><div className="mint"><span>Won together</span><strong>{joint.filter(r => r.outcome.success).length}</strong><small>of {joint.length} matches</small></div><div className="peach"><span>Competitive matches</span><strong>{rivalry.length}</strong><small>{rivalry.filter(r => r.outcome.winner === 'draw').length} draws</small></div></div>
    <div className="partner-scores">{room.names.map((name, s) => <div key={s}><span className={`avatar partner-${s}`}>{name.slice(0, 1)}</span><h3>{name}</h3><strong>{wins(s as Seat)} wins</strong><p>{rivalry.filter(r => r.outcome.winner === (s === 0 ? 1 : 0)).length} losses · {streak(s as Seat)} win streak</p></div>)}</div>
    <h3>By game</h3><div className="game-records">{(Object.keys(GAMES) as GameId[]).map(game => { const rows = room.records.filter(r => r.game === game); return <div key={game}><span>{GAMES[game].title}</span><small>{game === 'know' ? `${wins(0)}–${wins(1)} · ${rows.filter(r => r.outcome.winner === 'draw').length} draws` : `${rows.filter(r => r.outcome.success).length}/${rows.length} won · best ${Math.max(0, ...rows.map(r => r.outcome.score))}`}{game === 'sync' ? ` · streak ${Math.max(0, ...rows.map(r => r.bestStreak))}` : ''}</small></div>; })}</div>
    <h3>Recent matches</h3>{room.records.length === 0 ? <p className="empty-state">No matches yet.</p> : room.records.slice(0, 20).map(r => <div className="history-row" key={r.id}><div><strong>{GAMES[r.game].title}</strong><small>{new Date(r.finishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div><span>{r.outcome.winner === 'together' ? 'Won together' : r.outcome.winner === 'draw' ? 'A draw' : r.outcome.winner === 'none' ? 'Lost' : `${room.names[r.outcome.winner]} won`}</span></div>)}
  </div>;
}
