import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PawPrint } from 'lucide-react';
import type { CatMood } from '../../shared/types';
import { resolvePerch, type CatPlacement, type ScreenBox } from './catLayout';
const CatScene = lazy(() => import('./CatScene'));
const StaticCat = () => <img className="cat-static" src="/cat.svg" alt="" />;
class CatBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure(); }
  render() { return this.state.failed ? null : this.props.children; }
}
export function Host({ mood, effects, active, arrivalKey, instruction, inGame, help }: {
  mood: CatMood; effects: boolean; active: boolean; arrivalKey: string; instruction: string; inGame: boolean; help: () => void;
}) {
  const [visible, setVisible] = useState(!document.hidden);
  const [failed, setFailed] = useState(false);
  const [placement, setPlacement] = useState<CatPlacement>({ x: innerWidth - 56, y: innerHeight - 24, z: 0, anchor: '', hidden: false });
  const [bubble, setBubble] = useState('');
  const [speechSafe, setSpeechSafe] = useState(false);
  const [moving, setMoving] = useState(false);
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight, top: 0, left: 0 });
  const companion = useRef<HTMLDivElement>(null);
  const currentAnchor = useRef('');
  const currentDepth = useRef(0);
  const lastInteraction = useRef('');
  const visitedCard = useRef<Element | null>(null);
  const visitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animated = effects && !failed;
  const fail = useCallback(() => setFailed(true), []);

  const moveTo = useCallback((anchor: string, front?: boolean) => {
    const vv = visualViewport;
    const v = { width: vv?.width ?? innerWidth, height: vv?.height ?? innerHeight, top: vv?.offsetTop ?? 0, left: vv?.offsetLeft ?? 0 };
    const box = (el: Element): ScreenBox => { const r = el.getBoundingClientRect(); return { x: r.x - v.left, y: r.y - v.top, width: r.width, height: r.height }; };
    const target = document.querySelector(`[data-cat-anchor="${anchor}"]`);
    const obstacles = [...document.querySelectorAll('main button, main a, main input, main select, main textarea, header, .home-heading, .game-heading h1, .prompt-card h2, .match-score, .drawing-canvas, .answer-options, .clue-board')].filter(el => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
    }).map(box);
    const p = resolvePerch(target ? box(target) : undefined, v, obstacles);
    const speech = { x: p.x > v.width / 2 ? p.x - 138 : p.x - 42, y: p.y - 240, width: 180, height: 60 };
    setSpeechSafe(speech.y > 0 && speech.x >= 0 && speech.x + speech.width <= v.width && !obstacles.some(r => speech.x < r.x + r.width && speech.x + speech.width > r.x && speech.y < r.y + r.height && speech.y + speech.height > r.y));
    if (front !== undefined || anchor !== currentAnchor.current) currentDepth.current = front ? 110 : inGame ? -70 : 0;
    currentAnchor.current = anchor;
    p.anchor = anchor; p.z = currentDepth.current;
    setViewport(v); setPlacement(p); setMoving(animated && visible && !p.hidden);
    if (visitTimer.current) clearTimeout(visitTimer.current);
    visitedCard.current?.removeAttribute('data-cat-visited');
    visitedCard.current = null;
    if (target?.classList.contains('game-card')) {
      visitedCard.current = target;
      target.setAttribute('data-cat-visited', 'true');
      visitTimer.current = setTimeout(() => { target.removeAttribute('data-cat-visited'); visitedCard.current = null; }, 1800);
    }
  }, [inGame, animated, visible]);

  const pose = useCallback((x: number, y: number, scale: number, z: number) => {
    if (!companion.current) return;
    companion.current.style.transform = `translate3d(${x - 42}px,${y - 88}px,0) scale(${scale})`;
    companion.current.dataset.currentDepth = String(Math.round(z));
  }, []);
  const settled = useCallback(() => setMoving(false), []);
  useEffect(() => {
    const change = () => { setVisible(!document.hidden); if (document.hidden) setMoving(false); };
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => {
    if (!active) return;
    const destination = mood === 'celebrate' ? document.querySelector('[data-cat-anchor="result"]') ? 'result' : 'reveal' : mood === 'think' ? 'reveal' : inGame ? 'game' : document.querySelector('[data-cat-anchor="proposal"]') ? 'proposal' : 'doodle';
    lastInteraction.current = '';
    const frame = requestAnimationFrame(() => moveTo(destination, mood === 'celebrate'));
    setBubble(inGame && mood === 'explain' ? instruction : '');
    if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
    bubbleTimer.current = setTimeout(() => setBubble(''), 4400);
    const stroll = !inGame && animated ? [
      setTimeout(() => moveTo('sync'), 10000),
      setTimeout(() => moveTo('clue', true), 21000),
    ] : [];
    return () => { cancelAnimationFrame(frame); stroll.forEach(clearTimeout); };
  }, [arrivalKey, active, inGame, mood, instruction, animated, moveTo]);
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const layout = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => moveTo(currentAnchor.current)); };
    window.addEventListener('resize', layout); window.addEventListener('scroll', layout, true);
    visualViewport?.addEventListener('resize', layout); visualViewport?.addEventListener('scroll', layout);
    const resize = new ResizeObserver(layout); const main = document.querySelector('main'); if (main) resize.observe(main);
    const interact = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const card = event.target.closest('[data-cat-anchor]');
      if (card && !inGame) {
        const id = card.getAttribute('data-cat-anchor')!;
        if (lastInteraction.current !== id) { lastInteraction.current = id; moveTo(id, true); setBubble(''); }
      }
    };
    document.addEventListener('pointerover', interact); document.addEventListener('focusin', interact);
    return () => {
      cancelAnimationFrame(frame); resize.disconnect();
      window.removeEventListener('resize', layout); window.removeEventListener('scroll', layout, true);
      visualViewport?.removeEventListener('resize', layout); visualViewport?.removeEventListener('scroll', layout);
      document.removeEventListener('pointerover', interact); document.removeEventListener('focusin', interact);
    };
  }, [active, inGame, moveTo]);
  useEffect(() => () => { if (visitTimer.current) clearTimeout(visitTimer.current); visitedCard.current?.removeAttribute('data-cat-visited'); if (bubbleTimer.current) clearTimeout(bubbleTimer.current); }, []);
  useEffect(() => { if (!animated) { pose(placement.x, placement.y, 1, 0); setMoving(false); } }, [animated, placement, pose]);

  return <div className="cat-overlay" style={{ visibility: active && !placement.hidden ? 'visible' : 'hidden', left: viewport.left, top: viewport.top, width: viewport.width, height: viewport.height }}>
    {animated && <div className="cat-world"><CatBoundary onFailure={fail}><Suspense fallback={null}><CatScene placement={placement} mood={mood} visible={visible && active && !placement.hidden} onPose={pose} onSettled={settled} onFailure={fail} /></Suspense></CatBoundary></div>}
    <div ref={companion} className="cat-companion" data-anchor={placement.anchor} data-depth={placement.z > 0 ? 'front' : placement.z < 0 ? 'back' : 'middle'} data-moving={moving}
      style={{ transformOrigin: '50% 100%', transform: `translate3d(${placement.x - 42}px,${placement.y - 88}px,0)` }}>
      {bubble && speechSafe && !moving && <p className={`cat-speech ${placement.x > viewport.width / 2 ? 'speech-left' : 'speech-right'}`} role="status">{bubble}</p>}
      <button className={`cat-hit ${animated ? '' : 'cat-fallback'}`} aria-label="Ask the cat for help" onClick={() => { setBubble(''); help(); }}>
        {!animated ? <StaticCat /> : <span className="cat-help-hint"><PawPrint size={15} /></span>}
      </button>
    </div>
  </div>;
}
