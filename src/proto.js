// Minimal protobuf wire-format reader. ZappTV's API has no .proto file published, and its schema
// was reverse-engineered from the app's compiled (java) field constants, so we read by field
// number instead of generating typed message classes. Every getter is defensive: an absent or
// malformed field returns the fallback instead of throwing, since the server adds fields across
// versions and we only care about the ones we mapped.

/** Decodes one message's top-level fields into { [fieldNumber]: Array<{wireType, value}> }. */
export function decodeMessage(buf) {
  const fields = Object.create(null);
  let pos = 0;
  while (pos < buf.length) {
    let tag;
    [tag, pos] = readVarint(buf, pos);
    const fieldNum = tag >>> 3;
    const wireType = tag & 7;
    let value;
    if (wireType === 0) {
      [value, pos] = readVarint(buf, pos);
    } else if (wireType === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      value = buf.subarray(pos, pos + len);
      pos += len;
    } else if (wireType === 1) {
      value = buf.subarray(pos, pos + 8);
      pos += 8;
    } else if (wireType === 5) {
      value = buf.subarray(pos, pos + 4);
      pos += 4;
    } else {
      throw new Error(`unsupported wire type ${wireType} at byte ${pos}`);
    }
    (fields[fieldNum] ??= []).push({ wireType, value });
  }
  return fields;
}

function readVarint(buf, pos) {
  let result = 0, shift = 0, b;
  do {
    if (pos >= buf.length) throw new Error("truncated varint");
    b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}

const utf8 = new TextDecoder("utf-8", { fatal: false });

/** The first occurrence of field `n` as a UTF-8 string, or `fallback`. */
export function str(fields, n, fallback = "") {
  const v = fields[n]?.[0];
  return v && v.wireType === 2 ? utf8.decode(v.value) : fallback;
}

/** The first occurrence of field `n` as a number (varint fields only), or `fallback`. */
export function num(fields, n, fallback = 0) {
  const v = fields[n]?.[0];
  return v && v.wireType === 0 ? v.value : fallback;
}

/** The first occurrence of field `n`, decoded as a nested message, or `null`. */
export function msg(fields, n) {
  const v = fields[n]?.[0];
  return v && v.wireType === 2 ? decodeMessage(v.value) : null;
}

/** Every occurrence of repeated field `n`, each decoded as a nested message. */
export function repeatedMsg(fields, n) {
  return (fields[n] ?? []).filter((v) => v.wireType === 2).map((v) => decodeMessage(v.value));
}

/** Every occurrence of repeated field `n` as UTF-8 strings. */
export function repeatedStr(fields, n) {
  return (fields[n] ?? []).filter((v) => v.wireType === 2).map((v) => utf8.decode(v.value));
}
