import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import { CatmullRomCurve3, Group, Vector3 } from 'three';
import type { CatMood } from '../../shared/types';
import type { CatPlacement } from './catLayout';

function Cat({ placement, mood, visible, onPose, onSettled, onFailure }: {
  placement: CatPlacement; mood: CatMood; visible: boolean;
  onPose: (x: number, y: number, scale: number, z: number) => void; onSettled: () => void; onFailure: () => void;
}) {
  const root = useRef<Group>(null!); const head = useRef<Group>(null!);
  const tail = useRef<Group>(null!); const ears = useRef<Group>(null!);
  const eyes = useRef<Group>(null!); const legs = useRef<Group[]>([]);
  const current = useRef({ x: placement.x, y: placement.y, z: -100 });
  const from = useRef({ ...current.current });
  const started = useRef(0); const ended = useRef(false); const lastPose = useRef(0);
  const { invalidate, size, gl } = useThree();
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onFailure(); };
    gl.domElement.addEventListener('webglcontextlost', lost);
    return () => gl.domElement.removeEventListener('webglcontextlost', lost);
  }, [gl, onFailure]);
  useEffect(() => {
    from.current = { ...current.current }; started.current = performance.now(); ended.current = false; invalidate();
  }, [placement, mood, visible, invalidate]);
  useFrame(() => {
    if (!visible) return;
    const seconds = (performance.now() - started.current) / 1000;
    const p = Math.min(seconds / 1.65, 1); const ease = p * p * (3 - 2 * p);
    const dx = placement.x - from.current.x; const dy = placement.y - from.current.y;
    const traveling = Math.hypot(dx, dy) > 10;
    const hop = traveling && Math.abs(dy) > 36 ? Math.sin(p * Math.PI) * Math.min(65, Math.abs(dy) * .3 + 20) : 0;
    const x = from.current.x + dx * ease; const y = from.current.y + dy * ease - hop;
    const z = from.current.z + (placement.z - from.current.z) * ease + (traveling ? Math.sin(p * Math.PI) * 85 : 0);
    current.current = { x, y, z };
    const unit = 828.427 / size.height;
    const perspective = 1 - z / 1000;
    root.current.position.set((x - size.width / 2) * unit * perspective, (size.height / 2 - y) * unit * perspective, z);
    root.current.scale.setScalar(49 * unit);
    const stride = p < 1 && traveling ? Math.sin(seconds * 15) * .42 : 0;
    const activity = Math.max(0, 1 - seconds / 2.4);
    root.current.rotation.y = traveling && p < 1 ? Math.sign(dx || 1) * 1.05 * Math.sin(p * Math.PI) - .18 : -.18;
    root.current.rotation.z = hop ? -.09 * Math.sin(p * Math.PI * 2) : mood === 'celebrate' ? Math.sin(seconds * 9) * activity * .06 : 0;
    head.current.rotation.z = mood === 'think' ? .12 : mood === 'sleep' ? -.12 : Math.sin(seconds * 4) * activity * .035;
    head.current.rotation.y = p < 1 && traveling ? Math.sign(dx) * .12 : 0;
    ears.current.rotation.z = Math.sin(seconds * 7) * activity * .03;
    tail.current.rotation.z = Math.sin(seconds * 4.5) * activity * .15;
    legs.current.forEach((leg, i) => {
      leg.rotation.x = stride * (i % 2 ? -1 : 1);
      leg.rotation.z = !traveling && i === 0 && mood === 'explain' ? -.55 * activity : 0;
    });
    const blinking = mood === 'sleep' || seconds > 1.7 && seconds < 1.86;
    eyes.current.scale.y = blinking ? .12 : 1;
    if (mood === 'celebrate' && seconds < 2.4) root.current.position.y += Math.abs(Math.sin(seconds * 8)) * activity * 8 * unit;
    if (performance.now() - lastPose.current > 40 || p === 1) {
      onPose(x, y, 1 / perspective, z); lastPose.current = performance.now();
    }
    if (seconds < 2.4) invalidate();
    else if (!ended.current) { ended.current = true; onSettled(); }
  });
  const ink = '#1e242c';
  const tailCurve = useMemo(() => new CatmullRomCurve3([new Vector3(0, 0, 0), new Vector3(.3, .17, -.08), new Vector3(.48, .43, 0), new Vector3(.34, .67, .08), new Vector3(.16, .62, .1)]), []);
  const ball = (position: [number, number, number], scale: [number, number, number], color = ink) => <mesh position={position} scale={scale}><sphereGeometry args={[1, 20, 14]} /><meshStandardMaterial color={color} roughness={.78} /></mesh>;
  return <group ref={root}>
    {ball([0, .47, -.01], [.34, .46, .3])}
    {ball([0, .32, .08], [.29, .31, .26])}
    {[-1, 1].flatMap(side => [0, 1].map((front, i) => <group key={`${side}-${front}`} ref={el => { if (el) legs.current[(side === -1 ? 0 : 2) + i] = el; }} position={[side * .21, .3, front ? .14 : -.13]}>
      {ball([0, -.1, 0], [.105, .23, .11])}{ball([0, -.245, .08], [.14, .09, .18])}
    </group>))}
    <group ref={head} position={[0, .96, .06]}>
      {ball([0, 0, 0], [.47, .4, .34])}
      <group ref={ears}>{[-1, 1].map(side => <group key={side} position={[side * .31, .31, -.015]} rotation={[0, 0, -side * .18]}>
        <mesh><coneGeometry args={[.18, .39, 3]} /><meshStandardMaterial color={ink} roughness={.8} /></mesh>
        <mesh position={[0, .012, .09]} scale={[.53, .65, .17]}><coneGeometry args={[.18, .39, 3]} /><meshStandardMaterial color="#b3828d" roughness={.9} /></mesh>
      </group>)}</group>
      <group ref={eyes}>{[-1, 1].map(side => <group key={side} position={[side * .185, .02, .302]}>
        {ball([0, 0, 0], [.132, .144, .062], '#d6bd75')}
        <mesh position={[.015, -.004, .058]} scale={[.046, .111, .017]}><sphereGeometry args={[1, 18, 12]} /><meshBasicMaterial color="#10191b" /></mesh>
        <mesh position={[-.025, .052, .074]}><sphereGeometry args={[.024, 12, 8]} /><meshBasicMaterial color="#fff9dc" /></mesh>
        <mesh position={[.036, -.043, .071]}><sphereGeometry args={[.011, 10, 6]} /><meshBasicMaterial color="#fff9dc" /></mesh>
      </group>)}</group>
      {ball([-.07, -.13, .306], [.105, .085, .066], '#2c3038')}
      {ball([.07, -.13, .306], [.105, .085, .066], '#2c3038')}
      <mesh position={[0, -.092, .382]} rotation={[0, 0, Math.PI]}><coneGeometry args={[.041, .051, 3]} /><meshStandardMaterial color="#ac8088" /></mesh>
      {[-1, 1].map(side => <group key={side} position={[side * .21, -.1, .32]}>{[0, 1, 2].map(n => <mesh key={n} position={[side * .12, (n - 1) * .038, 0]} rotation={[0, 0, Math.PI / 2 + side * (n - 1) * .12]}><cylinderGeometry args={[.004, .004, .21, 5]} /><meshBasicMaterial color="#858a91" /></mesh>)}</group>)}
    </group>
    <group ref={tail} position={[.27, .25, -.17]}><mesh><tubeGeometry args={[tailCurve, 20, .063, 8, false]} /><meshStandardMaterial color={ink} roughness={.85} /></mesh></group>
    <mesh position={[0, -.045, -.025]} rotation={[-Math.PI / 2, 0, 0]} scale={[1, .58, 1]}><circleGeometry args={[.43, 24]} /><meshBasicMaterial color="#30332b" transparent opacity={.1} depthWrite={false} /></mesh>
  </group>;
}
function CatScene(props: { placement: CatPlacement; mood: CatMood; visible: boolean; onPose: (x: number, y: number, scale: number, z: number) => void; onSettled: () => void; onFailure: () => void }) {
  return <Canvas aria-hidden="true" frameloop="demand" dpr={1} camera={{ position: [0, 0, 1000], near: 1, far: 2000, fov: 45 }} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}>
    <ambientLight intensity={1.5} /><directionalLight position={[-200, 400, 800]} intensity={2.8} color="#e2e6fa" /><directionalLight position={[300, 150, 500]} intensity={1.6} color="#f0d7b3" />
    <Cat {...props} />
  </Canvas>;
}
export default memo(CatScene);
