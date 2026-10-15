// Generates build/icon.png (256×256) without any image library:
// a navy rounded square with a white "K" and a blue accent bar.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const S = 256
const SS = 4 // supersampling for smooth edges
const navy = [11, 31, 58]
const blue = [30, 90, 168]
const white = [255, 255, 255]

function inRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), S - r)
  const cy = Math.min(Math.max(y, r), S - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
function colorAt(x, y) {
  if (!inRoundRect(x, y, 52)) return null
  // Blue accent bar at the bottom
  if (y > 200 && y < 216 && x > 64 && x < 192) return blue
  // "K": vertical stem + two diagonals
  const w = 17
  if (distToSegment(x, y, 92, 52, 92, 184) < w) return white
  if (distToSegment(x, y, 104, 120, 170, 52) < w * 0.95) return white
  if (distToSegment(x, y, 112, 112, 172, 184) < w * 0.95) return white
  return navy
}

const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const c = colorAt(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
      if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255 }
    }
    const n = SS * SS
    const o = y * (S * 4 + 1) + 1 + x * 4
    const cov = a / 255
    raw[o] = cov ? Math.round(r / cov) : 0
    raw[o + 1] = cov ? Math.round(g / cov) : 0
    raw[o + 2] = cov ? Math.round(b / cov) : 0
    raw[o + 3] = Math.round(a / n)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4)
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', png)

// ICO wrapper with the PNG embedded (Windows Vista+ supports PNG-in-ICO).
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4)
const entry = Buffer.alloc(16)
entry[0] = 0; entry[1] = 0; entry[2] = 0; entry[3] = 0
entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(png.length, 8); entry.writeUInt32LE(22, 12)
writeFileSync('build/icon.ico', Buffer.concat([header, entry, png]))
console.log('Wrote build/icon.png and build/icon.ico', png.length, 'bytes')
