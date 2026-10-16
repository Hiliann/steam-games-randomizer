// Minimal synthetic fixtures following Steam appcache layouts, not copied user caches.
// Account 123/124, titles, access-token bytes and hashes are artificial.
import {crc32} from 'node:zlib';
import {decodeLicenseCache} from '../lib/steam-cache.mjs';

const u32 = n => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(n); return bytes; };
const cstr = s => Buffer.from(s + '\0');
function kv(object, strings) {
  return Buffer.concat([...Object.entries(object).flatMap(([key, value]) => {
    const name = strings ? u32(strings.indexOf(key)) : cstr(key);
    if (typeof value === 'object') return [Buffer.from([0]), name, kv(value, strings)];
    if (typeof value === 'number') return [Buffer.from([2]), name, u32(value)];
    return [Buffer.from([1]), name, cstr(value)];
  }), Buffer.from([8])]);
}
function packageCache(entries, version = 0x06565528) {
  return Buffer.concat([u32(version), u32(1), ...entries.flatMap(([id, apps, depots = []]) => [u32(id), Buffer.alloc(version === 0x06565528 ? 32 : 24), kv({ [id]: { appids: Object.fromEntries(apps.map((app, index) => [String(index), app])), depotids: Object.fromEntries(depots.map((depot, index) => [String(index), depot])) } })]), u32(0xffffffff)]);
}
function appCache(entries, version = 0x07564429) {
  const strings = ['appinfo', 'common', 'name', 'type'];
  const names = object => { for (const [key, value] of Object.entries(object)) { if (!strings.includes(key)) strings.push(key); if (value && typeof value === 'object') names(value); } };
  for (const [, , , depots] of entries) if (depots) names({ depots });
  const records = Buffer.concat([...entries.flatMap(([id, name, type = 'Game', depots]) => {
    const body = Buffer.concat([Buffer.alloc(version === 0x07564427 ? 40 : 60), kv({ appinfo: { common: { name, type }, ...(depots ? { depots } : {}) } }, version === 0x07564429 ? strings : undefined)]);
    return [u32(id), u32(body.length), body];
  }), u32(0)]);
  if (version !== 0x07564429) return Buffer.concat([u32(version), u32(1), records]);
  const pointer = Buffer.alloc(8); pointer.writeBigUInt64LE(BigInt(16 + records.length));
  return Buffer.concat([u32(version), u32(1), pointer, records, u32(strings.length), ...strings.map(cstr)]);
}
function varint(n) {
  const bytes = []; let value = BigInt(n);
  do { const byte = Number(value & 127n); value >>= 7n; bytes.push(byte | (value ? 128 : 0)); } while (value);
  return Buffer.from(bytes);
}
function licenseCache(licenses, account = 123) {
  const payload = Buffer.concat([Buffer.from([8, 1]), ...licenses.flatMap(item => {
    const row = Buffer.concat(Object.entries({ 1: item.id, 7: item.flags ?? 0, 9: item.type ?? 1, 12: item.owner ?? account, 17: 9007199254740993n }).flatMap(([field, value]) => [varint(Number(field) * 8), varint(value)]));
    return [Buffer.from([18]), varint(row.length), row];
  })]);
  return decodeLicenseCache(Buffer.concat([payload, u32(crc32(payload))]), account);
}
const steamId = id => String(76561197960265728n + BigInt(id));

export {u32,cstr,kv,packageCache,appCache,varint,licenseCache,steamId};
