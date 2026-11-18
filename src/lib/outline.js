const isDark = (data, offset) =>
  Math.max(data[offset], data[offset + 1], data[offset + 2]) <= 80;

export function repairOutline(data, width, height) {
  const count = width * height;
  const neighbors = Array.from({ length: count }, (_, i) => {
    const adjacent = [];
    if (i % width > 0) adjacent.push(i - 1);
    if (i % width < width - 1) adjacent.push(i + 1);
    if (i >= width) adjacent.push(i - width);
    if (i + width < count) adjacent.push(i + width);
    return adjacent;
  });

  // Walk from the edge so enclosed transparent holes stay transparent.
  const outside = new Uint8Array(count);
  const queue = [];
  function visit(i) {
    if (outside[i] || data[i * 4 + 3]) return;
    outside[i] = 1;
    queue.push(i);
  }
  for (let i = 0; i < count; i++) {
    if (neighbors[i].length < 4) visit(i);
  }
  for (let i = 0; i < queue.length; i++) {
    neighbors[queue[i]].forEach(visit);
  }

  const colors = new Map();
  let outline = [0, 0, 0, 255];
  let most = 0;
  for (let i = 0; i < count; i++) {
    const offset = i * 4;
    if (!data[offset + 3] || !isDark(data, offset)) continue;
    const adjacent = neighbors[i];
    if (adjacent.length === 4 && !adjacent.some((n) => outside[n])) continue;
    const rgb = data.slice(offset, offset + 3);
    const key = rgb.join(",");
    const seen = (colors.get(key) ?? 0) + 1;
    colors.set(key, seen);
    if (seen > most) {
      outline = [...rgb, 255];
      most = seen;
    }
  }

  const out = new Uint8ClampedArray(data);
  for (const i of queue) {
    if (neighbors[i].some((n) => data[n * 4 + 3] && !isDark(data, n * 4))) {
      out.set(outline, i * 4);
    }
  }
  return out;
}
