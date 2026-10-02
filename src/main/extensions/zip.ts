/**
 * zip の読み書き (Node の zlib だけで)。`.arsist` パッケージの入れ物。
 *
 * 依存を足さないための最小限の実装:
 *   - 書く: 格納 (store) か deflate。日時は固定 (同じ中身なら同じバイト列になる)
 *   - 読む: 中央ディレクトリから。暗号化・zip64・分割は扱わない (理由を付けて断る)
 * 中身の検査 (パスが外に出ないか等) は読む側 (packages.ts) で行う。ここは「書いてある通りに読む」だけ。
 */
import * as fs from 'fs';
import * as zlib from 'zlib';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_END = 0x06054b50;
// 1980-01-01 00:00 (DOS 時刻の最小)。中身が同じなら同じ zip にするため固定
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

let crcTable: Uint32Array | null = null;

export function crc32(data: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipInput {
  /** `/` 区切りの相対パス */
  name: string;
  data: Buffer;
}

export function writeZip(entries: ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(entry.data);
    const deflated = zlib.deflateRawSync(entry.data, { level: 9 });
    const useDeflate = deflated.length < entry.data.length;
    const body = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;
    if (body.length > 0xfffffffe || entry.data.length > 0xfffffffe) throw new Error(`${entry.name}: larger than 4 GB (zip64 is not supported)`);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(0x0800, 6);        // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by: unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);          // extra
    central.writeUInt16LE(0, 32);          // comment
    central.writeUInt16LE(0, 34);          // disk
    central.writeUInt16LE(0, 36);          // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_END, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuffer, end]);
}

export interface ZipEntry {
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  compressedSize: number;
  /** 中身 (CRC と大きさを確かめてから返す) */
  read(): Buffer;
}

export class ZipFormatError extends Error {}

export function readZip(zip: Buffer): ZipEntry[] {
  // 終わりの記録 (コメントの分だけ後ろにずれていることがある)
  let endAt = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (zip.readUInt32LE(i) === SIG_END) { endAt = i; break; }
  }
  if (endAt < 0) throw new ZipFormatError('not a zip file (no end of central directory)');

  const count = zip.readUInt16LE(endAt + 10);
  const centralSize = zip.readUInt32LE(endAt + 12);
  const centralOffset = zip.readUInt32LE(endAt + 16);
  if (count === 0xffff || centralOffset === 0xffffffff) throw new ZipFormatError('zip64 archives are not supported');
  if (zip.readUInt16LE(endAt + 4) !== 0 || zip.readUInt16LE(endAt + 6) !== 0) throw new ZipFormatError('split archives are not supported');
  if (centralOffset + centralSize > zip.length) throw new ZipFormatError('the central directory points outside the file');

  const entries: ZipEntry[] = [];
  let p = centralOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipFormatError(`broken central directory at entry ${i}`);
    const madeBy = zip.readUInt16LE(p + 4) >> 8;
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const compressedSize = zip.readUInt32LE(p + 20);
    const size = zip.readUInt32LE(p + 24);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const externalAttrs = zip.readUInt32LE(p + 38);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLength).toString('utf8');
    p += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) throw new ZipFormatError(`${name}: encrypted entries are not supported`);
    if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipFormatError(`${name}: zip64 entries are not supported`);
    }
    const unixMode = madeBy === 3 ? (externalAttrs >>> 16) & 0xffff : 0;
    const isSymlink = (unixMode & 0o170000) === 0o120000;
    const isDirectory = name.endsWith('/');

    entries.push({
      name,
      isDirectory,
      isSymlink,
      size,
      compressedSize,
      read: () => {
        if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== SIG_LOCAL) {
          throw new ZipFormatError(`${name}: broken local header`);
        }
        const start = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
        if (start + compressedSize > zip.length) throw new ZipFormatError(`${name}: data runs past the end of the file`);
        const raw = zip.subarray(start, start + compressedSize);
        let data: Buffer;
        if (method === 0) data = Buffer.from(raw);
        else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, size) });
        else throw new ZipFormatError(`${name}: compression method ${method} is not supported (use deflate or store)`);
        if (data.length !== size) throw new ZipFormatError(`${name}: size mismatch (${data.length} vs ${size})`);
        if (crc32(data) !== crc) throw new ZipFormatError(`${name}: CRC mismatch (the file is damaged)`);
        return data;
      },
    });
  }
  return entries;
}

// ---- ファイル単位 (大きなもの: プロジェクトのモデルなど) ----------------------------------
//
// 上の writeZip / readZip は全部をメモリに載せる。プロジェクトには数百 MB の ONNX が入ることがあるので、
// ここではファイルを 1 つずつ読み書きする。大きなファイル (STREAM_ABOVE 以上) は圧縮せず (store)、
// 2 回読む (CRC を出す → 書く) ことでメモリに載せない。ONNX はほとんど縮まないので失うものも小さい。


let STREAM_ABOVE = 64 * 1024 * 1024;

/** テスト用: 「大きいファイル」とみなす大きさを変える (既定 64 MB)。 */
export function setStreamThreshold(bytes: number): void {
  STREAM_ABOVE = bytes;
}

export interface ZipFileInput {
  name: string;
  /** ディスク上のファイル (data と どちらか) */
  file?: string;
  data?: Buffer;
}

async function crcOfFile(file: string): Promise<number> {
  let crc = 0xffffffff;
  if (!crcTable) crc32(Buffer.alloc(0)); // 表を作る
  for await (const chunk of fs.createReadStream(file)) {
    const b = chunk as Buffer;
    for (let i = 0; i < b.length; i++) crc = crcTable![(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** zip をファイルに書く (1 ファイルずつ)。戻り値は書いたバイト数。 */
export async function writeZipFile(outFile: string, entries: ZipFileInput[]): Promise<number> {
  const out = await fs.promises.open(outFile, 'w');
  const centrals: Buffer[] = [];
  let offset = 0;
  const writeBuf = async (b: Buffer) => { await out.write(b, 0, b.length, offset); offset += b.length; };
  try {
    for (const entry of entries) {
      const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
      const size = entry.data ? entry.data.length : (await fs.promises.stat(entry.file!)).size;
      if (size > 0xfffffffe) throw new Error(`${entry.name}: larger than 4 GB (zip64 is not supported)`);
      const streamed = !entry.data && size >= STREAM_ABOVE;

      let crc: number;
      let body: Buffer | null = null;
      let method = 0;
      if (streamed) {
        crc = await crcOfFile(entry.file!);
      } else {
        const data = entry.data ?? await fs.promises.readFile(entry.file!);
        crc = crc32(data);
        const deflated = zlib.deflateRawSync(data, { level: 6 });
        if (deflated.length < data.length) { body = deflated; method = 8; } else body = data;
      }
      const compressedSize = body ? body.length : size;
      const localOffset = offset;

      const local = Buffer.alloc(30);
      local.writeUInt32LE(SIG_LOCAL, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(DOS_TIME, 10);
      local.writeUInt16LE(DOS_DATE, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(compressedSize, 18);
      local.writeUInt32LE(size, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      await writeBuf(local);
      await writeBuf(name);
      if (body) await writeBuf(body);
      else {
        for await (const chunk of fs.createReadStream(entry.file!)) await writeBuf(chunk as Buffer);
      }

      const central = Buffer.alloc(46);
      central.writeUInt32LE(SIG_CENTRAL, 0);
      central.writeUInt16LE((3 << 8) | 20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0x0800, 8);
      central.writeUInt16LE(method, 10);
      central.writeUInt16LE(DOS_TIME, 12);
      central.writeUInt16LE(DOS_DATE, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(compressedSize, 20);
      central.writeUInt32LE(size, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      central.writeUInt32LE(localOffset, 42);
      centrals.push(central, name);
      if (offset > 0xfffffffe) throw new Error('the archive is larger than 4 GB (zip64 is not supported)');
    }
    const centralBuffer = Buffer.concat(centrals);
    const centralOffset = offset;
    await writeBuf(centralBuffer);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(SIG_END, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralBuffer.length, 12);
    end.writeUInt32LE(centralOffset, 16);
    await writeBuf(end);
    return offset;
  } finally {
    await out.close();
  }
}

export interface ZipFileEntry {
  name: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  /** ディスクに書き出す (CRC と大きさを確かめる。合わなければ消して投げる) */
  extractTo(dest: string): Promise<void>;
  /** 小さいものを読む */
  read(): Promise<Buffer>;
}

/** zip ファイルの目次を読む (中身はまだ読まない)。 */
export async function openZipFile(file: string): Promise<ZipFileEntry[]> {
  const fd = await fs.promises.open(file, 'r');
  try {
    const { size } = await fd.stat();
    const tailLength = Math.min(size, 22 + 0xffff);
    const tail = Buffer.alloc(tailLength);
    await fd.read(tail, 0, tailLength, size - tailLength);
    let endAt = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_END) { endAt = i; break; }
    }
    if (endAt < 0) throw new ZipFormatError('not a zip file (no end of central directory)');
    const count = tail.readUInt16LE(endAt + 10);
    const centralSize = tail.readUInt32LE(endAt + 12);
    const centralOffset = tail.readUInt32LE(endAt + 16);
    if (count === 0xffff || centralOffset === 0xffffffff) throw new ZipFormatError('zip64 archives are not supported');
    if (centralOffset + centralSize > size) throw new ZipFormatError('the central directory points outside the file');
    const central = Buffer.alloc(centralSize);
    await fd.read(central, 0, centralSize, centralOffset);

    const entries: ZipFileEntry[] = [];
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > central.length || central.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipFormatError(`broken central directory at entry ${i}`);
      const madeBy = central.readUInt16LE(p + 4) >> 8;
      const flags = central.readUInt16LE(p + 8);
      const method = central.readUInt16LE(p + 10);
      const crc = central.readUInt32LE(p + 16);
      const compressedSize = central.readUInt32LE(p + 20);
      const entrySize = central.readUInt32LE(p + 24);
      const nameLength = central.readUInt16LE(p + 28);
      const extraLength = central.readUInt16LE(p + 30);
      const commentLength = central.readUInt16LE(p + 32);
      const externalAttrs = central.readUInt32LE(p + 38);
      const localOffset = central.readUInt32LE(p + 42);
      const name = central.subarray(p + 46, p + 46 + nameLength).toString('utf8');
      p += 46 + nameLength + extraLength + commentLength;
      if (flags & 0x1) throw new ZipFormatError(`${name}: encrypted entries are not supported`);
      if (method !== 0 && method !== 8) throw new ZipFormatError(`${name}: compression method ${method} is not supported`);
      const unixMode = madeBy === 3 ? (externalAttrs >>> 16) & 0xffff : 0;

      const dataStart = async (): Promise<number> => {
        const h = await fs.promises.open(file, 'r');
        try {
          const header = Buffer.alloc(30);
          await h.read(header, 0, 30, localOffset);
          if (header.readUInt32LE(0) !== SIG_LOCAL) throw new ZipFormatError(`${name}: broken local header`);
          return localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
        } finally {
          await h.close();
        }
      };

      const extractTo = async (dest: string) => {
        const start = await dataStart();
        let crcAcc = 0xffffffff;
        let written = 0;
        if (!crcTable) crc32(Buffer.alloc(0));
        const check = new Transform({
          transform(chunk: Buffer, _enc, cb) {
            for (let k = 0; k < chunk.length; k++) crcAcc = crcTable![(crcAcc ^ chunk[k]) & 0xff] ^ (crcAcc >>> 8);
            written += chunk.length;
            if (written > entrySize) { cb(new ZipFormatError(`${name}: more data than declared`)); return; }
            cb(null, chunk);
          },
        });
        const source = fs.createReadStream(file, { start, end: compressedSize > 0 ? start + compressedSize - 1 : start - 1 });
        const stages: NodeJS.ReadWriteStream[] = method === 8 ? [zlib.createInflateRaw(), check] : [check];
        try {
          if (compressedSize === 0) await fs.promises.writeFile(dest, Buffer.alloc(0));
          else await pipeline(source, ...(stages as [NodeJS.ReadWriteStream]), fs.createWriteStream(dest));
          if (written !== entrySize) throw new ZipFormatError(`${name}: size mismatch (${written} vs ${entrySize})`);
          if (((crcAcc ^ 0xffffffff) >>> 0) !== crc) throw new ZipFormatError(`${name}: CRC mismatch (the file is damaged)`);
        } catch (e) {
          await fs.promises.rm(dest, { force: true });
          throw e;
        }
      };

      entries.push({
        name,
        isDirectory: name.endsWith('/'),
        isSymlink: (unixMode & 0o170000) === 0o120000,
        size: entrySize,
        extractTo,
        read: async () => {
          const start = await dataStart();
          const raw = Buffer.alloc(compressedSize);
          const h = await fs.promises.open(file, 'r');
          try { await h.read(raw, 0, compressedSize, start); } finally { await h.close(); }
          const data = method === 8 ? zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, entrySize) }) : raw;
          if (data.length !== entrySize || crc32(data) !== crc) throw new ZipFormatError(`${name}: damaged`);
          return data;
        },
      });
    }
    return entries;
  } finally {
    await fd.close();
  }
}
