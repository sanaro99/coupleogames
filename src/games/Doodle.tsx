import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';
import type { GameView, RoomState, Point, Stroke } from '../../shared/types';
import type { Act } from '../hooks/useRoom';
const COLORS = ['#26302d', '#e58b74', '#82a894', '#aa95c8', '#d8b356'];
export function Doodle({ m, room, act }: { m: GameView; room: RoomState; act: Act }) {
  const ref = useRef<HTMLCanvasElement>(null); const points = useRef<Point[]>([]); const pending = useRef(false); const lastSent = useRef(0);
  const [color, setColor] = useState(COLORS[0]); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [seconds, setSeconds] = useState(60);
  const drawer = room.seat === m.drawer; const canDraw = drawer && m.phase === 'play' && !m.paused;
  const skew = room.serverTime - Date.now();
  useEffect(() => { const update = () => setSeconds(Math.max(0, Math.ceil((m.paused ? m.remainingMs : (m.deadline ?? Date.now()) - (Date.now() + skew)) / 1000))); update(); const timer = setInterval(update, 250); return () => clearInterval(timer); }, [m.deadline, m.paused, m.remainingMs]);
  const paint = (stroke: Stroke) => {
    const canvas = ref.current!; const c = canvas.getContext('2d')!; const w = canvas.width; const h = canvas.height;
    c.strokeStyle = stroke.color; c.fillStyle = stroke.color; c.lineWidth = stroke.width * w; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); stroke.points.forEach((p, i) => i === 0 ? c.moveTo(p.x * w, p.y * h) : c.lineTo(p.x * w, p.y * h)); c.stroke();
    if (stroke.points.length === 1) { const p = stroke.points[0]; c.beginPath(); c.arc(p.x * w, p.y * h, stroke.width * w / 2, 0, Math.PI * 2); c.fill(); }
  };
  useEffect(() => { const c = ref.current!; c.getContext('2d')!.clearRect(0, 0, c.width, c.height); m.strokes.forEach(paint); if (points.current.length) paint({ color, width: .009, points: points.current }); }, [m.strokes, color]);
  const point = (e: React.PointerEvent<HTMLCanvasElement>): Point => { const r = e.currentTarget.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
  const flush = () => { if (!points.current.length) return; const chunk = points.current; points.current = [chunk[chunk.length - 1]]; void act({ type: 'stroke', stroke: { color, width: .009, points: chunk } }); lastSent.current = Date.now(); };
  return <div className="doodle-game"><div className="drawing-heading"><div><span className="drawing-label">{drawer ? 'Draw this' : `${room.names[m.drawer]} is drawing`}</span><h2 data-testid={drawer ? 'drawing-word' : undefined}>{drawer ? m.prompt : 'Guess the word'}</h2></div><span className={`timer ${seconds <= 10 ? 'urgent' : ''}`}>{seconds}s</span></div>
    <canvas ref={ref} width={900} height={690} className={`drawing-canvas ${canDraw ? 'drawable' : ''}`} aria-label="Drawing canvas"
      onPointerDown={e => { if (!canDraw) return; e.currentTarget.setPointerCapture(e.pointerId); pending.current = true; points.current = [point(e)]; lastSent.current = Date.now(); }}
      onPointerMove={e => { if (!pending.current || !canDraw) return; const p = point(e); points.current.push(p); paint({ color, width: .009, points: points.current.slice(-2) }); if (points.current.length >= 100 || Date.now() - lastSent.current > 90) flush(); }}
      onPointerUp={() => { if (pending.current) flush(); points.current = []; pending.current = false; }} onPointerCancel={() => { if (pending.current) flush(); points.current = []; pending.current = false; }} />
    {drawer ? <div className="drawing-tools"><div className="swatches">{COLORS.map(c => <button key={c} style={{ background: c }} className={color === c ? 'selected' : ''} aria-label={`Draw with ${c}`} aria-pressed={color === c} disabled={!canDraw} onClick={() => setColor(c)} />)}</div><button className="text-button" disabled={!canDraw} onClick={() => void act({ type: 'clear' })}><Eraser size={16} /> Clear</button></div> : <form className="guess-form" onSubmit={async e => { e.preventDefault(); setBusy(true); if (await act({ type: 'guess', text })) setText(''); setBusy(false); }}><label className="sr-only" htmlFor="guess">Your guess</label><input id="guess" value={text} onChange={e => setText(e.target.value)} autoComplete="off" maxLength={100} placeholder="Your best guess…" disabled={m.paused} /><button className="primary" disabled={m.paused || busy || !text.trim()}>Guess</button></form>}
    <div className="guesses">{m.guesses.slice(-4).map((g, i) => <span key={i}>{g}</span>)}</div>
  </div>;
}
