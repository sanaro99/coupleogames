import { describe, expect, it } from 'vitest';
import { planCatJourney, sampleCatJourney, samplePawStep, type CatPose } from '../src/components/catMotion';

const seated: CatPose = { x: 100, y: 200, z: 0, stand: 0, yaw: -.18, gait: 0, speed: 0, vx: 0, vy: 0, phase: 'idle', done: true };

describe('cat locomotion', () => {
  it('rises in place and is fully standing before travel', () => {
    const journey = planCatJourney(seated, { x: 400, y: 200, z: 0 });
    const rising = sampleCatJourney(journey, .45);
    expect(rising.x).toBe(100);
    expect(rising.y).toBe(200);
    expect(rising.stand).toBeGreaterThan(0);
    expect(rising.stand).toBeLessThan(1);
    const walking = sampleCatJourney(journey, 1.4);
    expect(walking.x).toBeGreaterThan(100);
    expect(walking.stand).toBe(1);
    expect(walking.speed).toBeGreaterThan(0);
  });

  it('takes longer to walk farther and advances its gait with distance', () => {
    const short = planCatJourney(seated, { x: 190, y: 200, z: 0 });
    const long = planCatJourney(seated, { x: 460, y: 200, z: 0 });
    expect(long.duration).toBeGreaterThan(short.duration + 2);
    const pose = sampleCatJourney(long, 2);
    expect(pose.gait).toBeGreaterThan(0);
  });

  it('keeps its current posture and gait when a walk is redirected', () => {
    const first = planCatJourney(seated, { x: 400, y: 200, z: 80 });
    const midWalk = sampleCatJourney(first, 2);
    const redirected = sampleCatJourney(planCatJourney(midWalk, { x: 50, y: 250, z: 0 }), 0);
    expect(redirected.x).toBe(midWalk.x);
    expect(redirected.y).toBe(midWalk.y);
    expect(redirected.z).toBe(midWalk.z);
    expect(redirected.stand).toBe(midWalk.stand);
    expect(redirected.yaw).toBe(midWalk.yaw);
    expect(redirected.gait).toBe(midWalk.gait);
    expect(redirected.speed).toBeCloseTo(midWalk.speed);
  });

  it('brakes smoothly instead of reversing velocity instantly on redirection', () => {
    const midWalk = sampleCatJourney(planCatJourney(seated, { x: 400, y: 200, z: 0 }), 2);
    const reversed = sampleCatJourney(planCatJourney(midWalk, { x: 50, y: 200, z: 0 }), .01);
    expect(reversed.x).toBeGreaterThan(midWalk.x);
    for (const offset of [0, 5, 10]) {
      const nearby = sampleCatJourney(planCatJourney(midWalk, { x: midWalk.x + offset, y: 200, z: 0 }), .001);
      expect(Math.abs(nearby.speed - midWalk.speed)).toBeLessThan(1);
    }
  });

  it('reaches the destination before lowering its haunches and finishes seated', () => {
    const journey = planCatJourney(seated, { x: 280, y: 250, z: 90 });
    const lowering = sampleCatJourney(journey, journey.duration - .4);
    expect(lowering.x).toBe(280);
    expect(lowering.y).toBe(250);
    expect(lowering.z).toBe(90);
    expect(lowering.speed).toBe(0);
    expect(lowering.stand).toBeGreaterThan(0);
    expect(lowering.stand).toBeLessThan(1);
    const finished = sampleCatJourney(journey, journey.duration + 1);
    expect(finished.stand).toBe(0);
    expect(finished.yaw).toBeCloseTo(-.18);
    expect(finished.done).toBe(true);
  });

  it('stays seated for a mood change at the same perch', () => {
    const pose = sampleCatJourney(planCatJourney(seated, seated), .2);
    expect(pose.stand).toBe(0);
    expect(pose.speed).toBe(0);
    expect(pose.x).toBe(100);
  });

  it('keeps a stance paw fixed as the body advances and lifts it only on swing', () => {
    const early = samplePawStep(Math.PI * 2 * .2, 0, 48);
    const later = samplePawStep(Math.PI * 2 * .4, 0, 48);
    expect(early.z + 38 * .2 / 48).toBeCloseTo(later.z + 38 * .4 / 48);
    expect(early.lift).toBe(0);
    expect(later.lift).toBe(0);
    expect(samplePawStep(Math.PI * 2 * .85, 0, 48).lift).toBeGreaterThan(.9);
  });
});
