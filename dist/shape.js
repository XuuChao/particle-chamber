// A contour becomes a filled mask, then a rounded volume of particle positions.
const MASK_SIZE = 192;

export function spherePositions(count, random = Math.random) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const y = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radius = Math.cbrt(random()) * .96;
    const ring = Math.sqrt(1 - y * y);
    positions.set([Math.cos(angle) * ring * radius, y * radius, Math.sin(angle) * ring * radius], i * 3);
  }
  return positions;
}

export function contourVolume(points, count, random = Math.random) {
  if (points.length < 3) throw new Error('Draw an outline first, then make particles.');
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
  if (Math.min(width, height) < .025) throw new Error('Give your outline some width and height.');

  // Fit into the mask with a clear outside border, without stretching the shape.
  const scale = (MASK_SIZE - 16) / Math.max(width, height);
  const offsetX = (MASK_SIZE - width * scale) / 2;
  const offsetY = (MASK_SIZE - height * scale) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = MASK_SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('The drawing canvas is unavailable. Please reload and try again.');
  ctx.beginPath();
  points.forEach((point, index) => {
    const x = (point.x - minX) * scale + offsetX;
    const y = (point.y - minY) * scale + offsetY;
    if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill('evenodd');
  const image = ctx.getImageData(0, 0, MASK_SIZE, MASK_SIZE).data;
  const distances = new Float32Array(MASK_SIZE * MASK_SIZE);
  let area = 0;
  for (let i = 0; i < distances.length; i++) {
    if (image[i * 4 + 3] > 127) { distances[i] = MASK_SIZE; area++; }
  }
  if (area < 100) throw new Error('Draw a wider outline with some space inside.');

  // Two chamfer passes approximate distance to the boundary in linear time.
  const diagonal = Math.SQRT2;
  for (let y = 1; y < MASK_SIZE - 1; y++) {
    for (let x = 1; x < MASK_SIZE - 1; x++) {
      const i = y * MASK_SIZE + x;
      if (distances[i]) distances[i] = Math.min(distances[i], distances[i - 1] + 1,
        distances[i - MASK_SIZE] + 1, distances[i - MASK_SIZE - 1] + diagonal,
        distances[i - MASK_SIZE + 1] + diagonal);
    }
  }
  for (let y = MASK_SIZE - 2; y > 0; y--) {
    for (let x = MASK_SIZE - 2; x > 0; x--) {
      const i = y * MASK_SIZE + x;
      if (distances[i]) distances[i] = Math.min(distances[i], distances[i + 1] + 1,
        distances[i + MASK_SIZE] + 1, distances[i + MASK_SIZE + 1] + diagonal,
        distances[i + MASK_SIZE - 1] + diagonal);
    }
  }

  const maxDistance = Math.max(...distances);
  const worldScale = 2.25 / (MASK_SIZE - 16);
  const halfDepth = Math.min(.65, .32 * Math.min(width, height) * scale * worldScale);
  const cells = [], weights = [];
  let totalWeight = 0;
  for (let i = 0; i < distances.length; i++) {
    if (!distances[i]) continue;
    const t = distances[i] / maxDistance;
    const depth = halfDepth * Math.sqrt(t * (2 - t));
    totalWeight += depth;
    cells.push({ x: i % MASK_SIZE, y: Math.floor(i / MASK_SIZE), depth });
    weights.push(totalWeight);
  }

  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Weight each column by depth for uniform density throughout the volume.
    const pick = random() * totalWeight;
    let low = 0, high = weights.length - 1;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (weights[middle] < pick) low = middle + 1; else high = middle;
    }
    const cell = cells[low];
    positions.set([
      (cell.x + random() - MASK_SIZE / 2) * worldScale,
      (MASK_SIZE / 2 - cell.y - random()) * worldScale,
      (random() * 2 - 1) * cell.depth,
    ], i * 3);
  }
  return positions;
}
