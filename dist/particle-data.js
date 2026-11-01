export const PARTICLE_COUNT = 32768;
export const TEXTURE_WIDTH = 256;
export const TEXTURE_HEIGHT = 128;

// Shared by simulation and shading so replenishment happens while transparent.
export const particleLifeGLSL = `
  float particleAge(float seed,float time) {
    float lifetime=4.5+fract(seed*73.3)*2.5;
    return fract(time/lifetime+fract(seed*319.3));
  }
`;

export function packPositions(positions) {
  if (!(positions instanceof Float32Array) || positions.length !== PARTICLE_COUNT * 3) {
    throw new Error(`Expected ${PARTICLE_COUNT} three-dimensional particle positions.`);
  }
  const data = new Float32Array(PARTICLE_COUNT * 4);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i * 3 + axis];
      if (!Number.isFinite(value)) throw new Error('Particle positions must be finite.');
      data[i * 4 + axis] = value;
    }
    data[i * 4 + 3] = (i + .5) / PARTICLE_COUNT;
  }
  return data;
}
