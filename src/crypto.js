// ZappTV wraps every API response in protobuf `Response{ code=1, message=2, data=3, sign=4 }`.
// `data` is base64 text, itself AES-128-ECB/PKCS5 ciphertext under a fixed key baked into the
// app's native library (libtool.so, function getFlag1 — extracted by disassembling the .so, not
// present anywhere in network traffic). The key never gated anything: the app ships it to every
// install, so this is obfuscation, not authentication. It is still kept as a manifest secret
// (`kino.secret("aesKey")`, apiVersion 6 typed cipher-key) rather than written in cleartext here,
// matching this plugin family's convention and keeping it out of a casual source read.
import { decodeMessage, str, num } from "./proto.js";

/**
 * Unwraps one `Response` envelope: throws a `kino.error` for a non-200 app code (ZappTV's own
 * business codes, not the HTTP status — e.g. 500 "Error del servidor", 4004 "needs newer app"),
 * otherwise returns the decrypted, decoded inner message's fields.
 */
export function unwrapEnvelope(bodyBytes) {
  const env = decodeMessage(bodyBytes);
  const code = num(env, 1);
  if (code !== 200) {
    const message = str(env, 2, "");
    throw kino.error("unavailable", message || `ZappTV respondió el código ${code}`);
  }
  const dataField = env[3]?.[0];
  if (!dataField) return decodeMessage(new Uint8Array(0));
  // The envelope's `data` bytes ARE the base64 text (ASCII), so decoding them as utf8 is lossless.
  const plainB64 = new TextDecoder("utf-8").decode(dataField.value);
  const plainHex = kino.crypto.decrypt("aes-128-ecb", {
    key: kino.secret("aesKey"),
    data: plainB64,
    inputEncoding: "base64",
    // The plaintext is itself binary protobuf, not text: ask for hex back, never utf8 (lossy for
    // non-ASCII bytes — this bit us once already, in the dev capture's own JSON trace log).
    outputEncoding: "hex",
  });
  if (typeof plainHex !== "string") throw kino.error("unavailable", "ZappTV: no se pudo descifrar la respuesta");
  return decodeMessage(hexToBytes(plainHex));
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
