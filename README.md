# kino-plugin-zapptv

A [Kino](https://github.com/kinotvapp/kino-light) plugin for [ZappTV](https://myzapptv.com): catálogo
(películas y series), búsqueda y reproducción. Instálalo en Kino (Ajustes ▸ Plugins) con
`xuper-plugin/kino-plugin-zapptv`.

Reconstruido por ingeniería inversa del APK oficial (v1.0.17 y v1.0.33) y de una captura MITM de la
app real: el envoltorio protobuf (`Response{code,message,data,sign}`), la clave AES-128-ECB fija del
cliente (`libtool.so`), el conjunto de cabeceras del dispositivo y el esquema de los mensajes
(`BlockInfo`, `ResRow`, `ResLiteInfo`, `ResInfo`, `Episode`, `Playback`). El catálogo, la búsqueda y
la reproducción funcionan completamente anónimos — ZappTV no exige login para su contenido público.

## Develop

```
npm install
npm run build          # bundles src/plugin.js -> plugin.js (esbuild)
node sdk/validate.mjs .
```

For a local run the kit needs the real AES key in `.kino-secrets.json` (gitignored, never commit
it) as `{ "aesKey": "<hex>" }` — see `src/crypto.js` for where it comes from. Once it's there:

```
node sdk/run.mjs . home
node sdk/run.mjs . search '{"q":"stick","type":"any"}'
node sdk/run.mjs . episodes 523945
node sdk/run.mjs . resolve 3878845462
node --test test/plugin.test.mjs
```
