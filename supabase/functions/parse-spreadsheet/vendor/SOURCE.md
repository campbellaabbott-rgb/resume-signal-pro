# vendor/xlsx.mjs

SheetJS Community Edition 0.20.3, the ES module build, unmodified.

- Source: https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs
- sha256: 1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db
- Size: 1,008,308 bytes
- Licence: Apache License 2.0 (https://cdn.sheetjs.com/xlsx-0.20.3/package/LICENSE); the file keeps its own copyright header.

Why it is carried here: parse-spreadsheet reads uploaded workbooks, and the
last build on the npm registry (0.18.5) predates the prototype-pollution fix
(CVE-2023-30533, fixed in 0.19.3) and the ReDoS fix (CVE-2024-22363, fixed in
0.20.2). Later builds are published only on SheetJS's own CDN, which Deno 2
does not import from by default, so the module is kept in the function's
folder and imported as `./vendor/xlsx.mjs`.

To move to a later release: download the new `package/xlsx.mjs` from the same
CDN path, replace this file, and write its URL, size and sha256 above.
src/test/the-spreadsheet-import-runs-a-patched-sheetjs.test.ts checks the
digest, the version and that the module reads a workbook.
