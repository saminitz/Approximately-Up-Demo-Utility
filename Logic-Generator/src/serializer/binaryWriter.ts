// Minimal growable little-endian binary writer.

export class BinaryWriter {
  private buf: Uint8Array;
  private view: DataView;
  private len = 0;

  constructor(initial = 1024) {
    this.buf = new Uint8Array(initial);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number): void {
    const need = this.len + extra;
    if (need <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < need) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  get length(): number {
    return this.len;
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.len, v & 0xff);
    this.len += 1;
    return this;
  }
  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.len, v | 0, true);
    this.len += 4;
    return this;
  }
  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.len, v >>> 0, true);
    this.len += 4;
    return this;
  }
  u64(v: bigint): this {
    this.ensure(8);
    this.view.setBigUint64(this.len, BigInt.asUintN(64, v), true);
    this.len += 8;
    return this;
  }
  f32(v: number): this {
    this.ensure(4);
    this.view.setFloat32(this.len, v, true);
    this.len += 4;
    return this;
  }
  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
    return this;
  }

  toUint8Array(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}
