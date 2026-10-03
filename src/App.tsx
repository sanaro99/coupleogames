import { useEffect, useState } from 'react';
import { PawPrint, Settings, Trophy, X } from 'lucide-react';
import { GAMES } from '../shared/games';
import type { CatMood, GameId } from '../shared/types';
import { useRoom } from './hooks/useRoom';
import { Host } from './components/Host';
import { Modal } from './components/Modal';
import { Lobby } from './components/Lobby';
import { Scorecard } from './components/Scorecard';
import { GamePanel } from './games/GamePanel';
import { InvitationLinks } from './components/InvitationLinks';

export default function App() {
  const { room, loading, connected, error, setError, send, act, login, logout, create, invitations } = useRoom();
  const [modal, setModal] = useState<'settings' | 'score' | 'rules' | 'invite' | null>(null);
  const [ruleGame, setRuleGame] = useState<GameId | null>(null);
  const [reduced, setReduced] = useState(() => localStorage.getItem('couple-effects') === 'reduced');
  const [animateHost, setAnimateHost] = useState(() => localStorage.getItem('couple-host') !== 'off');
  const [tableDepth, setTableDepth] = useState(() => localStorage.getItem('couple-depth') !== 'off');
  const [osReduced, setOsReduced] = useState(matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [key, setKey] = useState('');
  const [names, setNames] = useState<[string, string]>(['', '']);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setModal(null); setNames(['', '']); setKey(''); }, [room?.roomId, room?.seat]);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setOsReduced(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => { if (room && !room.setup) setNames(room.names); }, [room?.setup, room?.seat, room?.roomId]);
  const effects = !reduced && !osReduced;
  const rules = (game: GameId | null = room?.match?.game ?? room?.proposal?.game ?? null) => {
    setRuleGame(game); setModal('rules');
  };
  const invite = () => setModal('invite');
  const m = room?.match;
  const mood: CatMood = !room?.online.every(Boolean) ? 'sleep' : m?.phase === 'finished' || m?.matched ? 'celebrate' : m?.phase === 'reveal' ? 'think' : m ? 'explain' : 'welcome';
  const instruction = m?.phase === 'play' ? m.game === 'doodle' ? 'Draw without letters or numbers.' : m.game === 'sync' ? 'Answer without telling your partner.' : m.game === 'know' ? 'Choose your answer, then let your partner guess.' : 'Give one word and a count of 1 to 3.' : '';

  return <div className={`app ${effects ? '' : 'reduced-effects'}`}>
    <header className="site-header">
      <a href="/" className="brand"><span className="brand-mark"><PawPrint size={23} /></span><span>Couple<span className="brand-o">O</span>Games</span></a>
      {room?.setup && <div className="header-actions">
        <button className="icon-button" aria-label="Scorecard" onClick={() => setModal('score')}><Trophy size={20} /></button>
        <button className="icon-button" aria-label="Settings" onClick={() => setModal('settings')}><Settings size={20} /></button>
      </div>}
    </header>
    <main>
      {loading ? <p className="loading" role="status">Loading…</p> : !room ? <section className="entry panel">
        <h1>A little time together</h1><p>Start a private game for two, then invite your partner.</p>
        <button className="primary start-game" disabled={busy} onClick={async () => {setBusy(true);await create();setBusy(false);}}>Start a game</button>
        <div className="entry-divider" />
        <h2>Have an invitation?</h2><p>Paste your invitation code or link to join your partner.</p>
        <form onSubmit={async e => { e.preventDefault(); setBusy(true); await login(key); setBusy(false); }}>
          <label htmlFor="private-key">Invitation code</label>
          <input id="private-key" type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} />
          <button className="secondary" disabled={busy || !key.trim()}>Join a game</button>
        </form><img className="entry-cat" src="/cat.svg" alt="" />
      </section> : !room.setup ? <section className="entry panel">
        <h1>Your names</h1>
        {invitations && <><h2>Invite your partner</h2><InvitationLinks invitations={invitations} onError={setError} /></>}
        <form onSubmit={async e => { e.preventDefault(); setBusy(true); await send('setup', { names }); setBusy(false); }}>
          <label htmlFor="name-one">First partner’s name</label>
          <input id="name-one" maxLength={32} value={names[0]} onChange={e => setNames([e.target.value, names[1]])} autoComplete="given-name" />
          <label htmlFor="name-two">Second partner’s name</label>
          <input id="name-two" maxLength={32} value={names[1]} onChange={e => setNames([names[0], e.target.value])} autoComplete="off" />
          <button className="primary" disabled={busy || !connected || names.some(n => !n.trim())}>Start playing</button>
        </form>
      </section> : <>
        {!connected && <div className="pause-note" role="status">Reconnecting…</div>}
        {room.match ? <div className="play-layout"><GamePanel room={room} act={act} send={send} effects={effects && tableDepth} rules={() => rules()} /></div>
          : <Lobby room={room} send={send} invite={() => void invite()} rules={rules} />}
      </>}
    </main>
    {room?.setup && <Host mood={mood} effects={effects && animateHost} active={!modal} instruction={instruction}
      arrivalKey={m ? `${m.id}:${m.round}:${m.phase}:${m.cluePhase}` : room.proposal?.id ?? 'lobby'}
      inGame={!!m} help={() => rules()} />}
    {error && <div className="toast" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss message" onClick={() => setError('')}><X size={17} /></button></div>}
    {modal && <Modal title={modal === 'score' ? 'Scorecard' : modal === 'settings' ? 'Settings' : modal === 'invite' ? 'Invite your partner' : ruleGame ? GAMES[ruleGame].title : 'How to play'} close={() => setModal(null)}>
      {modal === 'score' && room && <Scorecard room={room} />}
      {modal === 'settings' && <div className="settings-content">
        <label className="toggle"><span><strong>Animate the cat</strong><small>Let the cat move around the page.</small></span><input aria-label="Animate the cat" type="checkbox" checked={animateHost} disabled={!effects} onChange={e => { setAnimateHost(e.target.checked); localStorage.setItem('couple-host', e.target.checked ? 'on' : 'off'); }} /></label>
        <label className="toggle"><span><strong>3D tiles</strong><small>Use 3D tiles in Clue Quest.</small></span><input aria-label="3D tiles" type="checkbox" checked={tableDepth} disabled={!effects} onChange={e => { setTableDepth(e.target.checked); localStorage.setItem('couple-depth', e.target.checked ? 'on' : 'off'); }} /></label>
        <label className="toggle"><span><strong>Reduce effects</strong><small>Use a still cat and simpler game boards.</small></span><input aria-label="Reduce effects" type="checkbox" checked={reduced} onChange={e => { setReduced(e.target.checked); localStorage.setItem('couple-effects', e.target.checked ? 'reduced' : 'auto'); }} /></label>
        {osReduced && <p className="muted">Your device has reduced motion enabled.</p>}
        {invitations && <button className="secondary" onClick={invite}>Your invitations</button>}
        <button className="secondary" onClick={async () => { await logout(); setModal(null); }}>Sign out</button>
      </div>}
      {modal === 'rules' && (ruleGame ? <div className="rules-content"><ol>{GAMES[ruleGame].rules.map(rule => <li key={rule}>{rule}</li>)}</ol><button className="primary" onClick={() => setModal(null)}>Got it</button></div>
        : <div className="help-games">{(Object.keys(GAMES) as GameId[]).map(game => <button className="secondary" key={game} onClick={() => setRuleGame(game)}>{GAMES[game].title}</button>)}</div>)}
      {modal === 'invite' && (invitations ? <InvitationLinks invitations={invitations} onError={setError} /> : <div className="invite-content"><p>The person who started this game has your partner’s invitation. If you started it yourself, open your saved return link to recover the invitation.</p></div>)}
    </Modal>}
  </div>;
}
