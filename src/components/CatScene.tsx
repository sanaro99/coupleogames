import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef } from 'react';
import { Group } from 'three';
import type { CatMood } from '../../shared/types';
import type { CatPlacement } from './catLayout';
import { planCatJourney, sampleCatJourney, samplePawStep, type CatPose } from './catMotion';
import { createKittenModel } from './kittenModel';

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const FOOT_PHASES = [.25, .75, 0, .5];
type Triple = [number, number, number];

function Cat({ placement, mood, visible, onPose, onSettled, onFailure }: {
  placement: CatPlacement; mood: CatMood; visible: boolean;
  onPose: (x: number, y: number, scale: number, z: number) => void;
  onSettled: () => void; onFailure: () => void;
}) {
  const model = useMemo(createKittenModel, []);
  const { geometry, material } = model;
  useEffect(() => () => model.dispose(), [model]);
  const ball = (position: Triple, scale: Triple, surface: keyof typeof material = 'coat') =>
    <mesh position={position} scale={scale} geometry={geometry.sphere} material={material[surface]} />;
  const root = useRef<Group>(null!);
  const torso = useRef<Group>(null!);
  const shoulders = useRef<Group>(null!);
  const haunches = useRef<Group>(null!);
  const neck = useRef<Group>(null!);
  const head = useRef<Group>(null!);
  const ears = useRef<Group>(null!);
  const eyes = useRef<Group>(null!);
  const closedEyes = useRef<Group>(null!);
  const tail = useRef<Group>(null!);
  const hips = useRef<Group[]>([]);
  const knees = useRef<Group[]>([]);
  const paws = useRef<Group[]>([]);
  const shadow = useRef<Group>(null!);
  const current = useRef<CatPose>({ x: placement.x, y: placement.y, z: placement.z,
    stand: 0, yaw: -.18, gait: 0, speed: 0, vx: 0, vy: 0, phase: 'idle', done: true });
  const journey = useRef(planCatJourney(current.current, placement));
  const started = useRef(0);
  const ended = useRef(false);
  const lastPose = useRef(0);
  const { invalidate, size, gl } = useThree();

  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onFailure(); };
    gl.domElement.addEventListener('webglcontextlost', lost);
    return () => gl.domElement.removeEventListener('webglcontextlost', lost);
  }, [gl, onFailure]);
  useEffect(() => {
    journey.current = planCatJourney(current.current, placement);
    started.current = performance.now();
    ended.current = false;
    invalidate();
  }, [placement, mood, visible, invalidate]);

  useFrame(() => {
    if (!visible) return;
    const now = performance.now();
    const seconds = (now - started.current) / 1000;
    const pose = sampleCatJourney(journey.current, seconds);
    current.current = pose;
    const { stand, gait, speed } = pose;
    const unit = 828.427 / size.height;
    const perspective = 1 - pose.z / 1000;
    const walking = Math.min(1, speed / 90);
    const bob = Math.cos(gait * 2) * .012 * walking;
    const sway = Math.sin(gait) * .018 * walking;
    const activity = Math.max(0, 1 - seconds / 2.4);

    root.current.position.set((pose.x - size.width / 2) * unit * perspective,
      (size.height / 2 - pose.y) * unit * perspective, pose.z);
    root.current.scale.setScalar(48 * unit);
    root.current.rotation.set(0, pose.yaw, 0);

    // The spine tips forward as the hips rise. The head stays above the shoulders.
    torso.current.position.set(sway * .25, mix(.43, .65, stand) + bob, mix(-.07, -.03, stand));
    torso.current.rotation.set(stand * Math.PI / 2, 0, sway);
    torso.current.scale.set(.29, mix(.38, .46, stand), .255);
    shoulders.current.position.set(sway, mix(.62, .68, stand) + bob, mix(.10, .27, stand));
    shoulders.current.scale.set(.245, mix(.27, .24, stand), .25);
    haunches.current.position.set(-sway * .6, mix(.25, .64, stand) - bob * .5, mix(-.18, -.30, stand));
    haunches.current.scale.set(mix(.32, .275, stand), .265, .27);
    neck.current.position.set(sway, mix(.78, .79, stand) + bob, mix(.12, .39, stand));
    neck.current.rotation.x = stand * .35;
    head.current.position.set(sway, mix(1.00, .96, stand) + bob, mix(.09, .51, stand));
    head.current.rotation.x = -.035 + stand * .08 + Math.sin(gait * 2) * .018 * walking;
    head.current.rotation.y = -sway * 1.5 - pose.yaw * .12 * walking;
    head.current.rotation.z = mood === 'think' ? .10 : mood === 'sleep' ? -.10 : .035 + Math.sin(seconds * 3) * activity * .02;
    ears.current.rotation.z = Math.sin(seconds * 6) * activity * .025;
    const restingEyes = mood === 'sleep' && pose.phase === 'idle' || seconds > 1.8 && seconds < 1.94;
    eyes.current.visible = !restingEyes;
    closedEyes.current.visible = restingEyes;

    // Four-beat walk: a paw travels back while planted, then lifts and swings forward.
    // Two-bone inverse kinematics gives each leg an elbow/knee and a level paw.
    hips.current.forEach((hip, index) => {
      const front = index < 2;
      const side = index % 2 ? 1 : -1;
      const upperLength = front ? .30 : .32;
      const lowerLength = .33;
      const step = samplePawStep(gait, FOOT_PHASES[index], 48 / perspective);
      const hipY = front ? mix(.57, .59, stand) + bob : mix(.27, .60, stand) - bob * .5;
      const hipZ = front ? mix(.10, .30, stand) : mix(-.21, -.31, stand);
      let footY = .065 + step.lift * .16 * walking;
      let footZ = (front ? .34 : -.34) + step.z * stand;
      if (index === 0 && mood === 'explain' && pose.phase === 'idle') {
        footY += .12 * activity;
        footZ += .07 * activity;
      }
      const dy = footY - hipY;
      const dz = footZ - hipZ;
      const reach = Math.max(.08, Math.min(upperLength + lowerLength - .002, Math.hypot(dy, dz)));
      const bend = Math.acos(Math.max(-1, Math.min(1,
        (upperLength ** 2 + reach ** 2 - lowerLength ** 2) / (2 * upperLength * reach))));
      const upperAngle = Math.atan2(-dz, -dy) + (front ? bend : -bend);
      const kneeY = hipY - Math.cos(upperAngle) * upperLength;
      const kneeZ = hipZ - Math.sin(upperAngle) * upperLength;
      const lowerAngle = Math.atan2(-(footZ - kneeZ), -(footY - kneeY));
      hip.position.set(side * (front ? .19 : .22), hipY, hipZ);
      hip.rotation.x = upperAngle;
      knees.current[index].rotation.x = lowerAngle - upperAngle;
      paws.current[index].rotation.x = -lowerAngle;
    });

    tail.current.position.set(.17, mix(.27, .64, stand) - bob * .5, mix(-.39, -.47, stand));
    tail.current.rotation.set(mix(-.15, -.3, stand), sway * .7,
      mix(-.28, -.18, stand) + Math.sin(seconds * 3 - .6) * (.045 * activity + .06 * walking));
    shadow.current.rotation.y = -pose.yaw;
    shadow.current.scale.set(mix(.40, .57 + Math.abs(Math.sin(pose.yaw)) * .13, stand), .065, 1);

    if (now - lastPose.current > 40 || pose.done && !ended.current) {
      onPose(pose.x, pose.y, 1 / perspective, pose.z);
      lastPose.current = now;
    }
    if (pose.done && !ended.current) { ended.current = true; onSettled(); }
    if (seconds < Math.max(2.4, journey.current.duration)) invalidate();
  });

  return <group ref={root} dispose={null}>
    <group ref={torso}>{ball([0, 0, 0], [1, 1, 1])}</group>
    <group ref={shoulders}>{ball([0, 0, 0], [1, 1, 1])}</group>
    <group ref={haunches}>{ball([0, 0, 0], [1, 1, 1])}</group>
    <group ref={neck}>{ball([0, 0, 0], [.215, .22, .215])}</group>
    {[0, 1, 2, 3].map(index => {
      const front = index < 2;
      const upperLength = front ? .30 : .32;
      return <group key={index} ref={el => { if (el) hips.current[index] = el; }}>
        {ball([0, -.07, 0], [front ? .105 : .14, front ? .135 : .18, front ? .115 : .15])}
        {ball([0, -upperLength / 2, 0], [front ? .083 : .108, upperLength * .60, front ? .09 : .115])}
        <group position={[0, -upperLength, 0]} ref={el => { if (el) knees.current[index] = el; }}>
          {ball([0, -.33 / 2, 0], [.076, .33 * .59, .08])}
          <group position={[0, -.33, 0]} ref={el => { if (el) paws.current[index] = el; }}>
            {ball([0, 0, .045], [.112, .065, .14])}
          </group>
        </group>
      </group>;
    })}
    <group ref={head}>
      {ball([0, 0, 0], [.415, .355, .34])}
      {[-1, 1].map(side => <group key={side}>
        {ball([side * .25, -.125, .12], [.165, .14, .16])}
      </group>)}
      <group ref={ears}>{[-1, 1].map(side => <group key={side} position={[side * .265, .235, -.015]} rotation={[.06, side * .10, -side * .25]}>
        <mesh geometry={geometry.ear} material={material.coat} />
        <mesh position={[0, .018, .040]} scale={[.68, .73, 1]} geometry={geometry.innerEar} material={material.innerEar} />
      </group>)}</group>
      <group ref={closedEyes} visible={false}>{[-1, 1].map(side => <mesh key={side}
        position={[side * .173, -.024, .311]} rotation={[0, side * .30, -side * .035]}
        geometry={geometry.closedEye} material={material.closedEye} />)}</group>
      <group ref={eyes}>{[-1, 1].map(side => <group key={side} position={[side * .173, -.024, .311]} rotation={[0, side * .30, -side * .035]}>
        {ball([0, 0, 0], [.131, .143, .050], 'iris')}
        {ball([.004, -.002, .036], [.110, .122, .025], 'irisInner')}
        {ball([.008, -.006, .054], [.090, .103, .022], 'pupil')}
        {ball([-.026, .043, .072], [.020, .024, .007], 'glint')}
        {ball([.045, -.040, .069], [.007, .009, .004], 'glint')}
      </group>)}</group>
      {ball([-.055, -.15, .312], [.084, .059, .082], 'muzzle')}
      {ball([.055, -.15, .312], [.084, .059, .082], 'muzzle')}
      {ball([0, -.213, .278], [.09, .044, .062])}
      <mesh position={[0, -.123, .397]} geometry={geometry.nose} material={material.nose} />
      <mesh geometry={geometry.mouth} material={material.mouth} />
      <mesh geometry={geometry.whiskers} material={material.whisker} />
    </group>
    <group ref={tail}>
      <mesh geometry={geometry.tail} material={material.coat} />
      {ball([-.035, .71, .035], [.057, .057, .057])}
    </group>
    <group ref={shadow} position={[0, -.01, 0]}><mesh geometry={geometry.shadow} material={material.shadow} /></group>
  </group>;
}

function CatScene(props: { placement: CatPlacement; mood: CatMood; visible: boolean; onPose: (x: number, y: number, scale: number, z: number) => void; onSettled: () => void; onFailure: () => void }) {
  return <Canvas aria-hidden="true" frameloop="demand" dpr={1} camera={{ position: [0, 0, 1000], near: 1, far: 2000, fov: 45 }} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}>
    <ambientLight intensity={1.5} />
    <directionalLight position={[-200, 400, 800]} intensity={2.8} color="#e2e6fa" />
    <directionalLight position={[300, 150, 500]} intensity={1.6} color="#f0d7b3" />
    <Cat {...props} />
  </Canvas>;
}
export default memo(CatScene);
