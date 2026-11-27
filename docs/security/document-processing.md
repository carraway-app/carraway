# Document retention and local text recognition

## Retention and deletion

Files are immutable and written once to file storage (`STORAGE_DIR`, key `dokumente/<ab>/<sha256>`). Deletion first marks the document
`geloescht` and hides it from everyone except admins. The file remains in storage for `DOKUMENT_AUFBEWAHRUNG_TAGE` days (default 30).
The worker then removes it only if no other document row with the same bytes (same SHA-256, shared file) is active or still within retention,
and no source citation, register extract or voucher points to it. Metadata remains with status `endgueltig_geloescht`. Page text is removed
with the file. Each deletion goes into the audit log and admins can see pending deletions (`GET /dokumente/aufbewahrung`). Downloads
then return 410. Superseded versions remain readable and downloadable because source citations refer to them. Backups include all file storage.

## Text extraction

Carraway extracts text from PDFs with a text layer, DOCX files (paragraphs and tables, with one page per section or roughly 3,000 characters) and
XLSX files (one page per sheet with the cell values). Uploaded Office files start at `ausstehend`. The worker extracts text outside the
request, with a time limit per document. First it checks the archive by unpacking each entry up to a hard limit. Individual entry reads
are limited to a few MB. The XML parser makes one forward pass. XML with document type declarations or entities is rejected with status
`fehler`, and the file stays in storage. Scans without a text layer remain at `kein_text` while OCR is off and have no extractable text.

## Optional local OCR

With `OCR=lokal` (default `aus`), the worker recognises text in scans (PDFs without a text layer, state `kein_text`) and images
(PNG, JPEG). All processing is local. The image includes a pinned version of `tesseract.js` and German and English language data from
`@tesseract.js-data/deu` and `/eng`, pinned with checksums in the lockfile. PDF.js renders pages with `@napi-rs/canvas`. There are no
runtime downloads or caches.

Uploads start at `ocr_ausstehend`. For existing documents, `POST /dokumente/:id/texterkennung` requests recognition. The worker
processes one document at a time in a dedicated thread. The page limit is `OCR_MAX_SEITEN` (default 20, excess pages give `fehler`).
A hard time limit (`OCR_ZEITLIMIT_SEKUNDEN`, default 180) terminates the thread. Timeouts and errors end immediately with `fehler`.
A worker crash allows up to three attempts. Text for each page is stored in `dokument_seite` with `quelle = ocr` and mean confidence
(0 to 100). Search and, in managed hosting, AI extraction use this text. Quotes and citations from OCR text are labelled
(`quelle` on suggestions, `zitat_quelle` on citations) because recognition can be wrong. The audit log records the page count,
confidence and duration of recognition and omits the text. Deleted documents receive no new extracted text.

**Memory limits.** Dimensions are read from the document before rendering or recognition (the PDF page's MediaBox or the PNG/JPEG
header). Images over `OCR_MAX_MEGAPIXEL` (default 40) result in `fehler`. PDF pages render at a reduced size as needed and are rejected
if they exceed twice the target size. Recognition runs in a memory-limited thread (`resourceLimits`). Canvas and WebAssembly memory
also count against the container limit (worker `mem_limit` in the Compose stack, `WORKER_SPEICHER`, plus `--max-old-space-size`).
Outside Docker, use a cgroup limit or `ulimit -v`.
