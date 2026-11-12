# pdf.js

Mozilla's PDF renderer, `pdfjs-dist` 4.10.38, legacy build (`legacy/build/`), Apache 2.0
(`LICENSE`). Ledger loads it only when a PDF on an Action is opened (2026-11-12), so it
draws the same in the browser and in the iPhone and Android apps. It's hosted here, like the
fonts, and never fetched from a CDN. Ledger opens PDFs with `isEvalSupported: false`.

To update it: `npm pack pdfjs-dist@<version>`, then copy `legacy/build/pdf.min.mjs` and
`legacy/build/pdf.worker.min.mjs` here.
