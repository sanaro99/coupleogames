import { ArrowUpRight, Check, CircleHelp, Link } from 'lucide-react';
import { GAMES } from '../../shared/games';
import type { GameId, RoomState } from '../../shared/types';
import { GameArt } from './GameArt';
export function Lobby({ room, send, invite, rules }: { room: RoomState; send: (event: string, value?: unknown) => Promise<boolean>; invite: () => void; rules: (game: GameId) => void }) {
  const partner = room.names[room.seat === 0 ? 1 : 0]; const bothHere = room.online.every(Boolean);
  return <div className="lobby" data-testid="game-menu">
    <div className="home-heading"><h1>{room.names[0]} <span>&</span> {room.names[1]}</h1>
      {!bothHere && <div className="waiting"><span>Waiting for {partner}</span><button className="text-button" onClick={invite}><Link size={14} /> Invite</button></div>}
    </div>
    {room.proposal && <section className="proposal panel" aria-live="polite" data-cat-anchor="proposal"><div><h2>{GAMES[room.proposal.game].title}</h2><p>{!bothHere ? `Waiting for ${partner}` : room.proposal.ready[room.seat === 0 ? 1 : 0] ? `${partner} is ready` : `Ready when ${partner} is`}</p></div><div className="proposal-actions"><button className="primary" disabled={room.proposal.ready[room.seat]} onClick={() => void send('ready', { proposalId: room.proposal!.id })}>{room.proposal.ready[room.seat] ? <><Check size={18} /> Waiting for {partner}</> : 'I’m ready'}</button><button className="text-button" onClick={() => rules(room.proposal!.game)}>How to play</button></div></section>}
    <div className="game-grid">{(Object.keys(GAMES) as GameId[]).map(id => { const game = GAMES[id]; return <article className={`game-card ${game.color}`} key={id} data-cat-anchor={id}>
      <GameArt game={id} /><h2>{game.title}</h2><p>{game.description}</p>
      <div className="game-meta"><span>{game.mode}</span><span>{game.time}</span></div>
      <div className="game-bottom"><button aria-label={`How to play ${game.title}`} className="icon-button card-help" onClick={() => rules(id)}><CircleHelp size={18} /></button><button aria-label={`Play ${game.title}`} className="play-button" onClick={() => void send('propose', { game: id })}>Play <ArrowUpRight size={16} /></button></div>
    </article>; })}</div>
  </div>;
}
