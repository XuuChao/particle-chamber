import test from 'node:test';
import assert from 'node:assert/strict';
import { spherePositions } from '../dist/shape.js';
import { PARTICLE_COUNT, TEXTURE_WIDTH, TEXTURE_HEIGHT, packPositions } from '../dist/particle-data.js';
import { PARTICLE_MIN, PARTICLE_MAX } from '../dist/chamber-bounds.js';

function randomGenerator() {
  let seed = 173;
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test('the full-quality grid contains exactly 32,768 particles', () => {
  assert.equal(PARTICLE_COUNT, 32768);
  assert.equal(TEXTURE_WIDTH * TEXTURE_HEIGHT, PARTICLE_COUNT);
});

test('the default sculpture stays inside the case and has depth in every direction', () => {
  const positions = spherePositions(PARTICLE_COUNT, randomGenerator());
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
  let interiorMin = Infinity;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const radius = Math.hypot(...positions.subarray(i * 3, i * 3 + 3));
    assert.ok(Number.isFinite(radius));
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(positions[i*3+axis]>PARTICLE_MIN[axis] && positions[i*3+axis]<PARTICLE_MAX[axis],
        'a source particle escapes the glass enclosure');
      low[axis] = Math.min(low[axis], positions[i * 3 + axis]);
      high[axis] = Math.max(high[axis], positions[i * 3 + axis]);
    }
    if (i >= Math.ceil(PARTICLE_COUNT * .7)) interiorMin = Math.min(interiorMin, radius);
  }
  for (let axis = 0; axis < 3; axis++) assert.ok(high[axis] - low[axis] > 1.4);
  assert.ok(interiorMin < .1);
});

test('GPU packing preserves target coordinates and assigns stable texel seeds', () => {
  const positions = spherePositions(PARTICLE_COUNT, randomGenerator());
  const copy = positions.slice();
  const data = packPositions(positions);
  assert.equal(data.length, PARTICLE_COUNT * 4);
  for (const i of [0, 1, 127, 256, PARTICLE_COUNT - 1]) {
    assert.deepEqual(data.subarray(i * 4, i * 4 + 3), positions.subarray(i * 3, i * 3 + 3));
    assert.ok(data[i * 4 + 3] > 0 && data[i * 4 + 3] < 1);
  }
  assert.deepEqual(positions, copy);
});

test('mist source has sparse outskirts instead of an abrupt spherical edge', () => {
  const positions=spherePositions(PARTICLE_COUNT,randomGenerator());
  let inner=0,middle=0,outer=0;
  for(let i=0;i<positions.length;i+=3) {
    const r=Math.hypot(positions[i],positions[i+1],positions[i+2]);
    if(r<.45)inner++;
    if(r>.55 && r<.8)middle++;
    if(r>1.0)outer++;
  }
  // Compare counts per unit volume, not raw counts in differently sized shells.
  const coreDensity=inner/(.45**3);
  const middleDensity=middle/(.8**3-.55**3);
  const tailDensity=outer/(1.24**3-1.0);
  assert.ok(outer>100,'there should be real wisps beyond the dense centre');
  assert.ok(tailDensity<coreDensity*.35,'the source should thin toward its edge');
  assert.ok(middleDensity>tailDensity*3,'there should be a gradual density profile');
});

test('invalid GPU targets are rejected before simulation state is changed', () => {
  assert.throws(() => packPositions(new Float32Array(3)), /Expected/);
  assert.throws(() => packPositions(Array(PARTICLE_COUNT * 3).fill(0)), /Expected/);
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  positions[173] = NaN;
  assert.throws(() => packPositions(positions), /finite/);
});
