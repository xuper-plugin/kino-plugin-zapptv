// The device headers ZappTV's API expects on every call (reverse-engineered from a MITM capture
// of the real app, v1.0.17 and v1.0.33 — identical header set in both). Catalog, search and
// playback all work fully anonymous: `token`/`uid` empty, no login call needed. `deviceId` is the
// only value worth keeping stable per install (so repeated calls look like the same device); it
// is generated once and cached in kino.storage, never sent anywhere outside ZappTV's own hosts.
const APP_ID = "f5a8c0603d1f4441a24f81bd1e62c0fa"; // fixed in every ZappTV install, not a secret
const CHANNEL = "S002";
const VER_CODE = "1033";
const VER_NAME = "v1.0.33";

function deviceId() {
  const cached = kino.storage.get("deviceId");
  if (cached) return cached;
  const fresh = kino.crypto.randomBytes(8, "hex");
  kino.storage.set("deviceId", fresh);
  return fresh;
}

export function headers() {
  return {
    lang: "es",
    serialId: "unknown",
    "Content-Encoding": "gzip", // sent by the real app's OkHttp client even on an empty body
    appId: APP_ID,
    uuid: "",
    verCode: VER_CODE,
    verName: VER_NAME,
    osVerCode: "33",
    osVerName: "13",
    hwBrand: "Kino",
    hwModel: "Kino",
    deviceId: deviceId(),
    mac: "unknown",
    wlanMac: "unknown",
    channel: CHANNEL,
    umid: "unknow", // exact value sent by the real app (not a typo we can fix)
    token: "",
    uid: "",
  };
}
