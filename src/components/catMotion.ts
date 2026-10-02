export interface CatPoint { x: number; y: number; z: number }
export interface CatPose extends CatPoint {
  stand: number;
  yaw: number;
  gait: number;
  speed: number;
  vx: number;
  vy: number;
  phase: 'idle' | 'rising' | 'walking' | 'settling' | 'sitting';
  done: boolean;
}
export interface CatJourney {
  from: CatPose;
  target: CatPoint;
  distance: number;
  heading: number;
  rise: number;
  walk: number;
  duration: number;
}

const REST_YAW = -.18;
const TURN_SECONDS = .38;
const SIT_SECONDS = .9;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => { const t = clamp(n); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
function turn(a: number, b: number, t: number) {
  const difference = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + difference * t;
}

function traveledDistance(journey: CatJourney, t: number) {
  const { from, target, walk, rise, distance } = journey;
  if (rise || !from.speed) return distance * (3 * t ** 2 - 2 * t ** 3);
  // Integrate the curved path, so paw timing follows distance even while braking.
  const intervals = 24;
  const width = t / intervals;
  let total = 0;
  for (let i = 0; i <= intervals; i++) {
    const p = i * width;
    const velocity = 3 * p ** 2 - 4 * p + 1;
    const progress = 6 * p * (1 - p);
    const x = (target.x - from.x) * progress + from.vx * walk * velocity;
    const y = (target.y - from.y) * progress + from.vy * walk * velocity;
    total += Math.hypot(x, y) * (i === 0 || i === intervals ? 1 : i % 2 ? 4 : 2);
  }
  return total * width / 3;
}

export function samplePawStep(gait: number, offset: number, pixelsPerUnit: number) {
  const cycle = (gait / (Math.PI * 2) + offset) % 1;
  const swing = Math.max(0, (cycle - .72) / .28);
  const reach = 38 * .72 / pixelsPerUnit / 2;
  return { z: cycle < .72 ? mix(reach, -reach, cycle / .72) : mix(-reach, reach, smooth(swing)),
    lift: Math.sin(swing * Math.PI) };
}

export function planCatJourney(from: CatPose, target: CatPoint): CatJourney {
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const distance = Math.hypot(dx, dy);
  const traveling = distance > 8 || from.speed > 0;
  const rise = traveling ? .95 * (1 - from.stand) : 0;
  const walk = traveling ? Math.max(.65, distance / 90) : 0;
  return {
    from: { ...from }, target: { x: target.x, y: target.y, z: target.z }, distance,
    heading: traveling ? distance > .1 ? Math.atan2(dx, dy * .45) : from.yaw : REST_YAW,
    rise, walk, duration: traveling ? rise + walk + TURN_SECONDS + SIT_SECONDS : SIT_SECONDS,
  };
}

// Sampling an elapsed timeline keeps the pose independent of display refresh rate.
// A new journey begins at this exact pose, including an unfinished rise or step.
export function sampleCatJourney(journey: CatJourney, elapsed: number): CatPose {
  const { from, target, rise, walk, duration, heading } = journey;
  const seconds = Math.max(0, elapsed);
  if (seconds >= duration) return { ...target, stand: 0, yaw: REST_YAW, gait: from.gait + (walk ? traveledDistance(journey, 1) / 38 * Math.PI * 2 : 0), speed: 0, vx: 0, vy: 0, phase: 'idle', done: true };
  if (!walk) {
    const ease = smooth(seconds / duration);
    return { x: mix(from.x, target.x, ease), y: mix(from.y, target.y, ease), z: mix(from.z, target.z, ease),
      stand: mix(from.stand, 0, ease), yaw: turn(from.yaw, REST_YAW, ease), gait: from.gait, speed: 0, vx: 0, vy: 0, phase: from.stand > 0 ? 'sitting' : 'idle', done: false };
  }
  if (seconds < rise) {
    const ease = smooth(seconds / rise);
    return { ...from, stand: mix(from.stand, 1, ease), yaw: turn(from.yaw, heading, ease), speed: 0, vx: 0, vy: 0, phase: 'rising', done: false };
  }

  const t = clamp((seconds - rise) / walk);
  // Hermite interpolation retains the velocity vector on a new destination.
  // A reversal first brakes in the old direction, then approaches the new perch.
  const progress = 3 * t ** 2 - 2 * t ** 3;
  const tangent = t ** 3 - 2 * t ** 2 + t;
  const startVx = rise ? 0 : from.vx;
  const startVy = rise ? 0 : from.vy;
  const vx = (target.x - from.x) / walk * 6 * t * (1 - t) + startVx * (3 * t ** 2 - 4 * t + 1);
  const vy = (target.y - from.y) / walk * 6 * t * (1 - t) + startVy * (3 * t ** 2 - 4 * t + 1);
  const speed = Math.hypot(vx, vy);
  const gait = from.gait + traveledDistance(journey, t) / 38 * Math.PI * 2;
  if (t < 1) {
    const turnProgress = smooth(seconds / Math.max(rise, TURN_SECONDS));
    return { x: mix(from.x, target.x, progress) + startVx * walk * tangent,
      y: mix(from.y, target.y, progress) + startVy * walk * tangent, z: mix(from.z, target.z, progress),
      stand: 1, yaw: turn(from.yaw, heading, turnProgress), gait, speed, vx, vy, phase: 'walking', done: false };
  }
  const arrival = seconds - rise - walk;
  return { ...target, stand: 1 - smooth((arrival - TURN_SECONDS) / SIT_SECONDS),
    yaw: turn(heading, REST_YAW, smooth(arrival / TURN_SECONDS)), gait, speed: 0, vx: 0, vy: 0,
    phase: arrival < TURN_SECONDS ? 'settling' : 'sitting', done: false };
}
