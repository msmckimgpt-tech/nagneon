import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { z } from 'zod';

const MAX = 24 * 1024 * 1024,
  STORAGE = 200 * 1024 * 1024;
function mediaType(b) {
  if (b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return ['image', 'image/png'];
  if (b.subarray(0, 3).toString('hex') === 'ffd8ff') return ['image', 'image/jpeg'];
  if (/^GIF8[79]a$/.test(b.subarray(0, 6).toString())) return ['image', 'image/gif'];
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP')
    return ['image', 'image/webp'];
  if (b.subarray(0, 4).toString('hex') === '1a45dfa3') return ['video', 'video/webm'];
  if (
    b.subarray(4, 8).toString() === 'ftyp' &&
    /^(isom|iso2|mp4[12]|avc1|M4V )$/.test(b.subarray(8, 12).toString())
  )
    return ['video', 'video/mp4'];
  throw Error('PNG·JPEG·GIF·WebP 이미지나 MP4·WebM 동영상만 첨부할 수 있습니다.');
}
export class SocialMedia {
  constructor(dir) {
    this.dir = dir;
    this.memory = new Map();
  }
  file(id) {
    z.string().uuid().parse(id);
    return join(this.dir, id + '.media');
  }
  used() {
    return this.dir && existsSync(this.dir)
      ? readdirSync(this.dir).reduce((n, f) => n + statSync(join(this.dir, f)).size, 0)
      : [...this.memory.values()].reduce((n, b) => n + b.length, 0);
  }
  save(buffer, name, generated = false) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > MAX)
      throw Error('첨부파일은 24MB 이하로 선택하세요.');
    const [kind, mime] = mediaType(buffer);
    if (kind === 'image' && buffer.length > 8 * 1024 * 1024)
      throw Error('이미지는 8MB 이하로 선택하세요.');
    if (this.used() + buffer.length > STORAGE)
      throw Error('커뮤니티 첨부 보관 공간 200MB에 도달했습니다. 첨부를 정리하세요.');
    const id = randomUUID(),
      meta = {
        id,
        kind,
        mime,
        bytes: buffer.length,
        name:
          String(name)
            .replace(/[\\/\x00-\x1f]/g, '_')
            .slice(0, 120) || '첨부파일',
        ...(generated ? { generated: true } : {}),
      };
    if (!this.dir) {
      this.memory.set(id, Buffer.from(buffer));
      return meta;
    }
    mkdirSync(this.dir, { recursive: true });
    const temp = this.file(id) + '.tmp';
    let fd;
    try {
      fd = openSync(temp, 'wx');
      writeFileSync(fd, buffer);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      renameSync(temp, this.file(id));
    } catch (e) {
      if (fd !== undefined) closeSync(fd);
      if (existsSync(temp)) unlinkSync(temp);
      throw e;
    }
    return meta;
  }
  exists(a) {
    return this.dir ? existsSync(this.file(a.id)) : this.memory.has(a.id);
  }
  read(a) {
    return this.dir ? readFileSync(this.file(a.id)) : this.memory.get(a.id);
  }
  remove(a) {
    if (this.dir) {
      if (existsSync(this.file(a.id))) unlinkSync(this.file(a.id));
    } else this.memory.delete(a.id);
  }
}

// Restricted pixel data only: no SVG/HTML, URLs, scripts or model-provided filenames.
export function pixelPng(scene) {
  let raw;
  try {
    raw = JSON.parse(scene);
  } catch {
    return null;
  }
  const parsed = z
    .object({
      palette: z
        .array(z.string().regex(/^#[0-9a-fA-F]{6}$/))
        .min(2)
        .max(8),
      pixels: z.array(z.string().regex(/^[0-7]{16}$/)).length(16),
    })
    .strict()
    .safeParse(raw);
  if (!parsed.success) return null;
  const { palette, pixels } = parsed.data;
  if (pixels.some((row) => [...row].some((n) => Number(n) >= palette.length))) return null;
  const chunk = (type, data) => {
    const head = Buffer.from(type),
      body = Buffer.concat([head, data]);
    let crc = 0xffffffff;
    for (const n of body) {
      crc ^= n;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const len = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    sum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([len, body, sum]);
  };
  const size = 256,
    ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const color = palette[Number(pixels[Math.floor(y / 16)][Math.floor(x / 16)])];
      const at = y * (size * 3 + 1) + 1 + x * 3;
      for (let c = 0; c < 3; c++) rows[at + c] = parseInt(color.slice(1 + c * 2, 3 + c * 2), 16);
    }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
