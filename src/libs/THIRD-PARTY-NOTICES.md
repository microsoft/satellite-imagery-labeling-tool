# Third-party notices and runtime support

Verified 2026-09-29. License texts for vendored JavaScript packages are stored in
`src/libs/licenses`.

## Vendored browser runtime assets

| Runtime asset | Version | License | SHA-256 |
|---|---:|---|---|
| Material Symbols 0.47.5 outlined WOFF2 | 0.47.5 | Apache-2.0 | `C5C96FCB27145D17A04CB2FA68D33921CA4258C6BB2CF6FAC8B1BCE401595E57` |
| DOMPurify 3.4.15 (`purify.min.js`) | 3.4.15 | Apache-2.0 OR MPL-2.0 | `F263B05369E050FA175D4ECB9C9358EB4253602D510297ADFB31DF48B2F1C4D5` |
| Clarinet 0.12.6 (`clarinet.js`) | 0.12.6 | BSD-2-Clause | `1EF7F55AE1EFC30543C949297BBC04936B56B2E39A222B3D1CC87DDFCA2D1740` |
| JSZip (`jszip.min.js`) | 3.10.1 | MIT or GPL-3.0 | `F12F367798E35EE2D9993DBA6167FC61DDB52FB89880F5A99FBB606335188410` |
| localForage (`localForage.min.js`) | 1.10.0 | Apache-2.0 | `5AD05227172C8FCC154E9E40D3881F0362C8487D583720F48344D232643E2F3B` |
| Marked (`marked.min.js`) | 4.0.18 | MIT | `39E2B6808D19ED0A6BA335DBFB9011C39A79CE4E7E23EFED3751218200B67FA3` |
| osmtogeojson (`osmtogeojson.js`) | 3.0.0 | MIT | `70931460AE907FD8A726B121B73DA96BE4EF870506F7ADD96D23962562F3D6E7` |
| Turf (`turf.min.js`) | 6.5.0 | MIT | `8E19874CE617EDA93279C55AE74560806ECB650761AE649BD9BCFE4F0BE0B42C` |
| Azure Maps Image Exporter (`azure-maps-image-exporter.min.js`) | 0.0.2 | MIT | `F17BE1D21DD1D4F0CB5CB8E1DC02090FCEDB2227E2437A82605539C94A79833F` |
| Azure Maps Bring Data Into View control (`azure-maps-bring-data-into-view-control.min.js`) | 0.0.2 | MIT | `8C09FC68F6F7F178E0CE1C57AAE64D9D56A24C22B4082DECF60D151C918C079E` |

## Azure Maps CDN integrity pins

Microsoft Learn documents both the Azure Maps CDN and locally hosted package distributions in
[Use the Azure Maps map control](https://learn.microsoft.com/azure/azure-maps/how-to-use-map-control)
and [Use the Azure Maps npm package](https://learn.microsoft.com/azure/azure-maps/how-to-use-npm-package).
This repository has no package build pipeline, so the supported static deployment uses the CDN with
Subresource Integrity and `crossorigin="anonymous"`. The CDN responses were verified to send
`Access-Control-Allow-Origin: *`. The major-version aliases are mutable; these pins intentionally
fail closed if upstream bytes change. Updating a pin requires reviewing and testing the new asset.

| Runtime asset | SRI SHA-384 | ETag at verification |
|---|---|---|
| Azure Maps Web SDK Map Control 3 JavaScript | `sha384-9/rcXx8mMp2NSsvBG2dGqmp1mvka1Th6mKwswKVg1KmLwaj+oScWpZBF6u6Waejb` | `"0x8DE948082A1F979"` |
| Azure Maps Web SDK Map Control 3 CSS | `sha384-59ojKv+oBxaGUcP1dK+iHONfFFO09inCib+Zg2wV6WXmAJwinV4bp+hQ1s4HU0g6` | `"0x8DE9480828E988B"` |
| Azure Maps Drawing Tools 1 JavaScript | `sha384-hSbiDCEvgwFU7fM+sPrh7qXUW8sML+ngq+ax0n3lqflMDtAg6giLXAOsnvJ3oZjr` | `"0x8DCFC85F7DCF892"` |
| Azure Maps Drawing Tools 1 CSS | `sha384-0aMUOBPV5vyPlTfGQjpTxMKef45D6FZbzhB3Im4IBb+4lEUGNo7AYu7J3jywnBsI` | `"0x8DCFC85F7D0022B"` |
| Azure Maps Spatial IO 0 JavaScript | `sha384-I45x3rkxF55Pva8mnkoEa3U6JSKO7aoL6H/qYeqMuFcJ96k0QOH6ZAp6oLd1tMEq` | `"0x8DED585F4520775"` |

## Minimum supported browsers

The fixed project support floor is **Chromium 105, Firefox 102, and WebKit 16.0** (including Edge
105 and Safari 16.0). These versions are the minimum supported versions, not a claim that every
older browser fails.

The floor was verified against the shipped dependencies and required platform features on
2026-09-29:

- Azure Maps supports the current and previous major desktop browsers and requires WebGL 2; the
  fixed project floor is intentionally more conservative than WebGL 2 availability.
- WOFF2, Web Workers, Blob worker URLs, Subresource Integrity, Fetch, IndexedDB, and ES modules are
  available at or before all three fixed floors.
- The application test matrix exercises current Playwright Chromium, Firefox, and WebKit engines;
  the fixed floors provide a stable compatibility policy for runtime syntax and APIs while that
  current-engine matrix detects forward regressions.

References:
[Azure Maps supported browsers](https://learn.microsoft.com/azure/azure-maps/supported-browsers),
[MDN WebGL 2](https://developer.mozilla.org/docs/Web/API/WebGL2RenderingContext),
[MDN Subresource Integrity](https://developer.mozilla.org/docs/Web/Security/Subresource_Integrity),
and [MDN WOFF](https://developer.mozilla.org/docs/Web/CSS/CSS_fonts/WOFF).
