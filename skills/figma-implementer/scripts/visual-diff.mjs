#!/usr/bin/env node
/**
 * Compares a design render with a screenshot of the implementation, pixel by pixel.
 *
 *   node scripts/visual-diff.mjs design.png page.png [--out diff.png] [--max 2] [--threshold 24] [--json]
 *
 * Both images are PNGs. When their sizes differ the page image is scaled to the design's size, and
 * the report says so: capture the page at the design's scale (an element screenshot at a device
 * pixel ratio of 1 for a 1x render) for a fair comparison. Transparent areas are compared over white.
 *
 * A pixel differs when a channel differs by more than `--threshold` (0-255, default 24) and no pixel
 * next to it in the other image is within the threshold, which forgives the one-pixel anti-aliasing
 * shifts between renderers. The report gives the share of differing pixels, and the regions where
 * they cluster, largest first, in design pixels. `--out` writes the design faded, with differing
 * pixels in red. Exit code: 0 when the share is at most `--max` percent (default 2), 1 when above, 2
 * on unreadable input. A share under the threshold is not a verdict: look at every region reported.
 *
 * No dependencies: PNG is decoded and encoded here (8- and 16-bit; grayscale, RGB, palette, and alpha;
 * not interlaced).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const fail = (message) => {
  console.error(message);
  process.exit(2);
};

// ── PNG ──────────────────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** A PNG as { width, height, rgba }, eight bits a channel. */
export function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, i) => buffer[i] === byte)) throw new Error('not a PNG');
  let offset = 8;
  let header;
  let palette;
  let transparency;
  const data = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        interlace: body[12],
      };
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new Error('no IHDR chunk');
  const { width, height, depth, color, interlace } = header;
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');
  if (depth !== 8 && depth !== 16) throw new Error(`a bit depth of ${depth} is not supported`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  if (!channels) throw new Error(`PNG color type ${color} is not supported`);
  const bytesPerPixel = channels * (depth / 8);
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(data));
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : undefined;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? out[x - bytesPerPixel] : 0;
      const up = previous ? previous[x] : 0;
      const corner = previous && x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - corner;
        const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - corner)];
        value += a <= b && a <= c ? left : b <= c ? up : corner;
      } else if (filter !== 0) throw new Error(`unknown PNG filter ${filter}`);
      out[x] = value & 0xff;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  const sample = (index) => (depth === 16 ? pixels[index * 2] : pixels[index]);
  for (let i = 0; i < width * height; i += 1) {
    const base = i * channels;
    let r;
    let g;
    let b;
    let a = 255;
    if (color === 0 || color === 4) {
      r = g = b = sample(base);
      if (color === 4) a = sample(base + 1);
      else if (transparency && depth === 8 && transparency.readUInt16BE(0) === r) a = 0;
    } else if (color === 2 || color === 6) {
      [r, g, b] = [sample(base), sample(base + 1), sample(base + 2)];
      if (color === 6) a = sample(base + 3);
    } else {
      const entry = pixels[i];
      [r, g, b] = [palette[entry * 3], palette[entry * 3 + 1], palette[entry * 3 + 2]];
      if (transparency && entry < transparency.length) a = transparency[entry];
    }
    rgba.set([r, g, b, a], i * 4);
  }
  return { width, height, rgba };
}

/** An RGBA image as a PNG. */
export function encodePng({ width, height, rgba }) {
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Comparison ───────────────────────────────────────────────────────

/** Each pixel over white, as RGB. */
const flatten = ({ width, height, rgba }) => {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    const a = rgba[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c += 1) rgb[i * 3 + c] = Math.round(rgba[i * 4 + c] * a + 255 * (1 - a));
  }
  return rgb;
};

/** An image scaled to a size by nearest neighbour. */
const scale = (image, width, height) => {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(image.width - 1, Math.floor((x * image.width) / width));
      const sy = Math.min(image.height - 1, Math.floor((y * image.height) / height));
      rgba.set(image.rgba.subarray((sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4), (y * width + x) * 4);
    }
  }
  return { width, height, rgba };
};

/** How two images differ: the share of differing pixels, where they cluster, and a picture of it. */
export function compare(design, page, { threshold = 24 } = {}) {
  const scaled = page.width !== design.width || page.height !== design.height;
  const target = scaled ? scale(page, design.width, design.height) : page;
  const { width, height } = design;
  const a = flatten(design);
  const b = flatten(target);
  const near = (one, i, other, j) =>
    Math.abs(one[i * 3] - other[j * 3]) <= threshold &&
    Math.abs(one[i * 3 + 1] - other[j * 3 + 1]) <= threshold &&
    Math.abs(one[i * 3 + 2] - other[j * 3 + 2]) <= threshold;
  // Differs only when no neighbour in the other image matches, either way round.
  const matchedNearby = (one, other, x, y) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && near(one, y * width + x, other, ny * width + nx)) return true;
      }
    }
    return false;
  };
  const differs = new Uint8Array(width * height);
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (near(a, i, b, i)) continue;
      if (matchedNearby(a, b, x, y) && matchedNearby(b, a, x, y)) continue;
      differs[i] = 1;
      count += 1;
    }
  }

  // Regions: cells where differing pixels gather, joined with their neighbours.
  const cell = Math.max(4, Math.round(Math.min(width, height) / 24));
  const columns = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const hot = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      let inCell = 0;
      let all = 0;
      for (let y = row * cell; y < Math.min(height, (row + 1) * cell); y += 1) {
        for (let x = column * cell; x < Math.min(width, (column + 1) * cell); x += 1) {
          inCell += differs[y * width + x];
          all += 1;
        }
      }
      if (inCell / all > 0.05) hot[row * columns + column] = 1;
    }
  }
  const regions = [];
  const seen = new Uint8Array(columns * rows);
  for (let start = 0; start < hot.length; start += 1) {
    if (!hot[start] || seen[start]) continue;
    const queue = [start];
    seen[start] = 1;
    let [minX, minY, maxX, maxY, pixels] = [Infinity, Infinity, -1, -1, 0];
    while (queue.length) {
      const at = queue.pop();
      const column = at % columns;
      const row = Math.floor(at / columns);
      minX = Math.min(minX, column);
      maxX = Math.max(maxX, column);
      minY = Math.min(minY, row);
      maxY = Math.max(maxY, row);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = column + dx;
        const nr = row + dy;
        const next = nr * columns + nc;
        if (nc >= 0 && nr >= 0 && nc < columns && nr < rows && hot[next] && !seen[next]) {
          seen[next] = 1;
          queue.push(next);
        }
      }
    }
    const box = {
      x: minX * cell,
      y: minY * cell,
      width: Math.min(width, (maxX + 1) * cell) - minX * cell,
      height: Math.min(height, (maxY + 1) * cell) - minY * cell,
    };
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) pixels += differs[y * width + x];
    }
    regions.push({ ...box, differingPixels: pixels });
  }
  regions.sort((one, two) => two.differingPixels - one.differingPixels);

  const picture = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const gray = Math.round(0.6 * 255 + 0.4 * (a[i * 3] * 0.3 + a[i * 3 + 1] * 0.59 + a[i * 3 + 2] * 0.11));
    picture.set(differs[i] ? [230, 20, 20, 255] : [gray, gray, gray, 255], i * 4);
  }
  return {
    width,
    height,
    scaledFrom: scaled ? { width: page.width, height: page.height } : undefined,
    differingPixels: count,
    differingShare: Math.round((count / (width * height)) * 10000) / 100,
    regions: regions.slice(0, 10),
    picture: { width, height, rgba: picture },
  };
}

// ── Command ──────────────────────────────────────────────────────────

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const option = (name, fallback) => {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : fallback;
  };
  const files = args.filter((arg, i) => !arg.startsWith('--') && !['--out', '--max', '--threshold'].includes(args[i - 1]));
  if (files.length !== 2) fail('Usage: node scripts/visual-diff.mjs design.png page.png [--out diff.png] [--max 2] [--threshold 24] [--json]');
  let design;
  let page;
  try {
    [design, page] = files.map((file) => decodePng(readFileSync(file)));
  } catch (error) {
    fail(`Cannot read the images: ${error.message}`);
  }
  const max = Number(option('--max', 2));
  const result = compare(design, page, { threshold: Number(option('--threshold', 24)) });
  const out = option('--out');
  if (out) writeFileSync(out, encodePng(result.picture));
  const { picture, ...report } = result;
  if (args.includes('--json')) console.log(JSON.stringify({ ...report, max, passed: report.differingShare <= max, diff: out }, null, 2));
  else {
    if (report.scaledFrom) console.log(`The page image (${report.scaledFrom.width}x${report.scaledFrom.height}) was scaled to the design's ${report.width}x${report.height}.`);
    console.log(`${report.differingShare}% of pixels differ (${report.differingPixels} of ${report.width * report.height}).`);
    for (const region of report.regions) {
      console.log(`  region at ${region.x},${region.y}, ${region.width}x${region.height}: ${region.differingPixels} differing pixels`);
    }
    if (out) console.log(`Diff written to ${out}.`);
  }
  process.exit(report.differingShare <= max ? 0 : 1);
}
