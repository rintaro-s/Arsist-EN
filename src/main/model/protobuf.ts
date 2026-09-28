/**
 * protobuf のワイヤ形式の最小の読み書き。
 *
 * ONNX はただの protobuf なので、入出力の名前と形を知るだけなら
 * 専用ライブラリ (onnx-proto など数 MB) は要らない。ここにあるのは
 * 「フィールド番号と型を順に取り出す」だけの、依存の無い 100 行ほどの実装。
 *
 * 大きなモデル (重みが数百 MB) でも、length-delimited の中身は subarray で
 * 眺めるだけで写さない。
 */

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_BYTES = 2;
export const WIRE_FIXED32 = 5;

export interface ProtoField {
  num: number;
  wire: number;
  /** varint / fixed は数 (2^53 を超えるものは bigint)、bytes は Uint8Array のビュー */
  value: number | bigint | Uint8Array;
}

function readVarint(buf: Uint8Array, at: number): { value: number | bigint; next: number } {
  let result = 0n;
  let shift = 0n;
  let i = at;
  for (;;) {
    if (i >= buf.length) throw new Error('protobuf: truncated varint');
    const b = buf[i++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7n;
    if (shift > 70n) throw new Error('protobuf: varint too long');
  }
  const asNumber = result <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(result) : result;
  return { value: asNumber, next: i };
}

/** 1つのメッセージのフィールドを順に列挙する。入れ子はもう一度 readFields に掛ける。 */
export function readFields(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let i = 0;
  while (i < buf.length) {
    const tag = readVarint(buf, i);
    i = tag.next;
    const key = Number(tag.value);
    const num = key >>> 3;
    const wire = key & 7;

    switch (wire) {
      case WIRE_VARINT: {
        const v = readVarint(buf, i);
        fields.push({ num, wire, value: v.value });
        i = v.next;
        break;
      }
      case WIRE_FIXED64: {
        if (i + 8 > buf.length) throw new Error('protobuf: truncated fixed64');
        const view = new DataView(buf.buffer, buf.byteOffset + i, 8);
        const big = view.getBigUint64(0, true);
        fields.push({ num, wire, value: big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big });
        i += 8;
        break;
      }
      case WIRE_BYTES: {
        const len = readVarint(buf, i);
        i = len.next;
        const n = Number(len.value);
        if (i + n > buf.length) throw new Error('protobuf: truncated bytes');
        fields.push({ num, wire, value: buf.subarray(i, i + n) });
        i += n;
        break;
      }
      case WIRE_FIXED32: {
        if (i + 4 > buf.length) throw new Error('protobuf: truncated fixed32');
        const view = new DataView(buf.buffer, buf.byteOffset + i, 4);
        fields.push({ num, wire, value: view.getUint32(0, true) });
        i += 4;
        break;
      }
      default:
        // group (3/4) は proto3 に無い。ここに来たら ONNX ではない。
        throw new Error(`protobuf: unsupported wire type ${wire}`);
    }
  }
  return fields;
}

const utf8 = new TextDecoder('utf-8');

export function fieldString(field: ProtoField): string {
  return field.value instanceof Uint8Array ? utf8.decode(field.value) : String(field.value);
}

export function fieldBytes(field: ProtoField): Uint8Array {
  if (!(field.value instanceof Uint8Array)) throw new Error(`protobuf: field ${field.num} is not bytes`);
  return field.value;
}

export function fieldNumber(field: ProtoField): number {
  return typeof field.value === 'bigint' ? Number(field.value) : Number(field.value);
}

/** packed repeated varint (dims など) を展開する。packed でなければ 1 要素。 */
export function fieldVarints(field: ProtoField): number[] {
  if (!(field.value instanceof Uint8Array)) return [fieldNumber(field)];
  const out: number[] = [];
  let i = 0;
  while (i < field.value.length) {
    const v = readVarint(field.value, i);
    out.push(typeof v.value === 'bigint' ? Number(v.value) : v.value);
    i = v.next;
  }
  return out;
}

// ---- 書く側 (テストとサンプルモデル用。読む側と対になる) ----

export class ProtoWriter {
  private chunks: number[] = [];

  private varint(value: number | bigint): void {
    let v = BigInt(value);
    if (v < 0n) v += 1n << 64n; // 負の int64 は 10 バイトの 2 の補数
    for (;;) {
      const b = Number(v & 0x7fn);
      v >>= 7n;
      if (v === 0n) { this.chunks.push(b); break; }
      this.chunks.push(b | 0x80);
    }
  }

  private tag(num: number, wire: number): void {
    this.varint((num << 3) | wire);
  }

  int(num: number, value: number | bigint): this {
    this.tag(num, WIRE_VARINT);
    this.varint(value);
    return this;
  }

  string(num: number, value: string): this {
    return this.bytes(num, new TextEncoder().encode(value));
  }

  bytes(num: number, value: Uint8Array): this {
    this.tag(num, WIRE_BYTES);
    this.varint(value.length);
    for (const b of value) this.chunks.push(b);
    return this;
  }

  message(num: number, build: (w: ProtoWriter) => void): this {
    const inner = new ProtoWriter();
    build(inner);
    return this.bytes(num, inner.finish());
  }

  /** packed repeated int64 */
  packedInts(num: number, values: number[]): this {
    const inner = new ProtoWriter();
    for (const v of values) inner.varint(v);
    return this.bytes(num, inner.finish());
  }

  float32(num: number, value: number): this {
    this.tag(num, WIRE_FIXED32);
    const b = new Uint8Array(4);
    new DataView(b.buffer).setFloat32(0, value, true);
    for (const x of b) this.chunks.push(x);
    return this;
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}
