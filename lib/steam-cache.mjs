// Read-only readers for Steam's local cache formats. These files are metadata,
// not an ownership source by themselves; only license-listed packages are used.
import { crc32 } from 'node:zlib';
class Reader {
  constructor(bytes, offset = 0, end = bytes.length) { this.bytes = bytes; this.offset = offset; this.end = end; }
  take(size) {
    if (!Number.isSafeInteger(size) || size < 0 || this.offset + size > this.end) throw new Error('Truncated Steam cache');
    const start = this.offset; this.offset += size;
    return this.bytes.subarray(start, this.offset);
  }
  u8() { return this.take(1)[0]; }
  u32() { return this.take(4).readUInt32LE(); }
  string() {
    const end = this.bytes.indexOf(0, this.offset);
    if (end < this.offset || end >= this.end || end - this.offset > 1024 * 1024) throw new Error('Invalid cache string');
    return this.take(end - this.offset + 1).subarray(0, -1).toString('utf8');
  }
  object(strings, depth = 0) {
    if (depth > 30) throw new Error('Cache nesting limit');
    const result = Object.create(null);
    while (true) {
      const type = this.u8();
      if (type === 8) return result;
      const key = strings ? strings[this.u32()] : this.string();
      if (typeof key !== 'string') throw new Error('Invalid cache string index');
      switch (type) {
        case 0: result[key] = this.object(strings, depth + 1); break;
        case 1: result[key] = this.string(); break;
        case 2: case 4: case 6: result[key] = this.u32(); break;
        case 3: result[key] = this.take(4).readFloatLE(); break;
        case 7: case 10: this.take(8); break; // Unneeded 64-bit values (including tokens) are not retained.
        default: throw new Error('Unsupported cache value type');
      }
    }
  }
}

export function parsePackageInfo(bytes, wanted, { ownedDepots } = {}) {
  const reader = new Reader(bytes);
  const version = reader.u32(); reader.u32();
  if (![0x06565527, 0x06565528].includes(version)) throw new Error('Unsupported packageinfo version');
  const packages = new Map();
  while (true) {
    const id = reader.u32();
    if (id === 0xffffffff) return packages;
    reader.take(version === 0x06565528 ? 32 : 24);
    const data = reader.object()[String(id)];
    if (!wanted || wanted.has(String(id))) {
      const apps = Object.values(data?.appids ?? {}).map(String).filter(value => /^[1-9]\d*$/.test(value));
      packages.set(String(id), apps);
      if (ownedDepots) {
        for (const depotId of Object.values(data?.depotids ?? {}).map(String)) {
          if (/^[1-9]\d*$/.test(depotId)) ownedDepots.add(depotId);
        }
      }
    }
  }
}

export function parseAppInfo(bytes, wanted) {
  const reader = new Reader(bytes);
  const version = reader.u32(); reader.u32();
  if (![0x07564427, 0x07564428, 0x07564429].includes(version)) throw new Error('Unsupported appinfo version');
  let strings;
  if (version === 0x07564429) {
    const offset = Number(reader.take(8).readBigUInt64LE());
    if (!Number.isSafeInteger(offset) || offset < reader.offset || offset >= bytes.length) throw new Error('Invalid cache string table');
    const table = new Reader(bytes, offset);
    const count = table.u32();
    if (count > 1000000 || count > bytes.length - table.offset) throw new Error('Oversized cache string table');
    strings = Array.from({ length: count }, () => table.string());
    reader.end = offset;
  }
  const apps = new Map();
  while (true) {
    const id = reader.u32();
    if (id === 0) return apps;
    const size = reader.u32();
    const headerSize = version === 0x07564427 ? 40 : 60;
    if (size < headerSize || reader.offset + size > reader.end) throw new Error('Invalid appinfo record size');
    const record = new Reader(bytes, reader.offset + headerSize, reader.offset + size);
    reader.take(size);
    if (wanted && !wanted.has(String(id))) continue;
    const app = record.object(strings).appinfo;
    const common = app?.common;
    if (typeof common?.name === 'string' && common.name.trim() && typeof common.type === 'string') {
      apps.set(String(id), { id: String(id), name: common.name.trim().slice(0, 512), type: common.type.toLowerCase(), depots: app.depots });
    }
  }
}

// Steam obfuscates licensecache using an account-seeded Park-Miller stream with
// a 32-slot shuffle table. It does not require a password or session credential.
export function decodeLicenseCache(bytes, accountId) {
  if (!Number.isInteger(accountId) || accountId < 1 || accountId > 0xffffffff) throw new Error('Invalid account ID');
  let seed = Math.abs(accountId | 0) || 1;
  const table = new Array(32);
  const advance = () => { seed = (seed * 16807) % 2147483647; return seed; };
  for (let i = 39; i >= 0; i--) { advance(); if (i < 32) table[i] = seed; }
  let value = table[0];
  const decoded = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    do {
      advance();
      const slot = Math.floor(value / 67108864);
      value = table[slot]; table[slot] = seed;
    } while (value > 2147483647 - (2147483648 % 95));
    decoded[i] = bytes[i] ^ (32 + value % 95);
  }
  return decoded;
}

function* protobuf(bytes) {
  const reader = new Reader(bytes);
  function varint() {
    let value = 0n;
    for (let i = 0; i < 10; i++) {
      const byte = reader.u8(); value |= BigInt(byte & 127) << BigInt(i * 7);
      if (byte < 128) return value;
    }
    throw new Error('Invalid license varint');
  }
  while (reader.offset < reader.end) {
    const tag = Number(varint());
    if (!Number.isSafeInteger(tag) || tag < 8) throw new Error('Invalid license field');
    const field = Math.floor(tag / 8), wire = tag % 8;
    if (wire === 0) yield [field, Number(varint())];
    else if (wire === 2) yield [field, reader.take(Number(varint()))];
    else if (wire === 5) yield [field, reader.u32()];
    else if (wire === 1) reader.take(8);
    else throw new Error('Unsupported license wire type');
  }
}

export function parseLicenses(bytes, accountId) {
  if (bytes.length < 6) throw new Error('Truncated licensecache');
  const decoded = decodeLicenseCache(bytes, accountId);
  if (crc32(decoded.subarray(0, -4)) !== decoded.readUInt32LE(decoded.length - 4)) throw new Error('License checksum mismatch');
  let success = false;
  const licenses = [];
  // Steam appends four checksum bytes after its CMsgClientLicenseList message.
  for (const [field, value] of protobuf(decoded.subarray(0, -4))) {
    if (field === 1) success = value === 1;
    if (field !== 2 || !Buffer.isBuffer(value)) continue;
    const license = { packageId: null, flags: 0, owner: 0, type: 0 };
    for (const [key, item] of protobuf(value)) {
      if (!Number.isInteger(item) || item < 0 || item > 0xffffffff) continue;
      if (key === 1) license.packageId = String(item);
      if (key === 7) license.flags = item;
      if (key === 9) license.type = item;
      if (key === 12) license.owner = item;
    }
    if (license.packageId !== null) licenses.push(license);
  }
  if (!success) throw new Error('License cache not successful');
  return licenses;
}

export function ownedPackageIds(licenses, accountId) {
  // Fail closed for inactive, borrowed, refundable and time-limited licenses.
  const unavailable = 0x02 | 0x04 | 0x08 | 0x10 | 0x20 | 0x400 | 0x800 | 0x2000 | 0x4000 | 0x40000 | 0x80000;
  return new Set(licenses.filter(item => item.type !== 0 && !(item.flags & unavailable) && (!item.owner || item.owner === accountId)).map(item => item.packageId));
}
