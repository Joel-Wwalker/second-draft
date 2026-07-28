import { HumanizerError } from './types';

/**
 * Minimal, dependency-free reader for the one thing we need from a .docx file:
 * the text inside word/document.xml. A .docx is a ZIP archive; we parse just
 * enough of the ZIP format (central directory, one local file header) to pull
 * that single entry out and inflate it if needed. Nothing here is a general
 * purpose ZIP reader: unsupported or inconsistent structure is rejected
 * rather than guessed at.
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_FILE_SIGNATURE = 0x04034b50;

const EOCD_SIZE = 22;
const CENTRAL_DIR_HEADER_SIZE = 46;
const LOCAL_HEADER_SIZE = 30;
const MAX_EOCD_COMMENT = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

const DOCUMENT_ENTRY_NAME = 'word/document.xml';
const MALFORMED_MESSAGE = 'Could not read that .docx file.';

const utf8Decoder = new TextDecoder('utf-8');

function malformed(): HumanizerError {
  return new HumanizerError('internal', MALFORMED_MESSAGE);
}

interface CentralDirEntry {
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Reads the ZIP central directory, finds word/document.xml, inflates it if
 * needed, and converts the OOXML body into plain text. Throws
 * HumanizerError('internal', ...) on any malformed archive or a missing
 * document part; never returns partial or best-guess output for those cases.
 */
export async function extractDocxText(bytes: ArrayBuffer): Promise<string> {
  try {
    const view = new DataView(bytes);
    const entry = findDocumentEntry(view);
    const xmlBytes = await readEntryBytes(view, entry);
    const xml = utf8Decoder.decode(xmlBytes);
    return xmlToText(xml);
  } catch (err) {
    if (err instanceof HumanizerError) throw err;
    throw malformed();
  }
}

/** Scans backward from the end of the buffer for the EOCD record, tolerating a trailing comment. */
function findEndOfCentralDirectory(view: DataView): number {
  const maxCommentLength = Math.min(view.byteLength - EOCD_SIZE, MAX_EOCD_COMMENT);
  if (maxCommentLength < 0) throw malformed();
  for (let commentLength = 0; commentLength <= maxCommentLength; commentLength++) {
    const offset = view.byteLength - EOCD_SIZE - commentLength;
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw malformed();
}

/** Walks the central directory (bounded by the declared entry count) looking for word/document.xml. */
function findDocumentEntry(view: DataView): CentralDirEntry {
  const eocdOffset = findEndOfCentralDirectory(view);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirSize = view.getUint32(eocdOffset + 12, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  if (centralDirOffset + centralDirSize > eocdOffset) throw malformed();

  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + CENTRAL_DIR_HEADER_SIZE > view.byteLength) throw malformed();
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) throw malformed();

    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);

    const nameStart = offset + CENTRAL_DIR_HEADER_SIZE;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > view.byteLength) throw malformed();

    if (decodeUtf8(view, nameStart, nameLength) === DOCUMENT_ENTRY_NAME) {
      return { compressionMethod, compressedSize, uncompressedSize, localHeaderOffset };
    }
    offset = nameEnd + extraLength + commentLength;
  }
  throw malformed();
}

/** Reads the local file header for one entry and returns its decompressed bytes. */
async function readEntryBytes(view: DataView, entry: CentralDirEntry): Promise<Uint8Array> {
  const offset = entry.localHeaderOffset;
  if (offset + LOCAL_HEADER_SIZE > view.byteLength) throw malformed();
  if (view.getUint32(offset, true) !== LOCAL_FILE_SIGNATURE) throw malformed();

  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataStart = offset + LOCAL_HEADER_SIZE + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > view.byteLength) throw malformed();
  const compressed = new Uint8Array(view.buffer, view.byteOffset + dataStart, entry.compressedSize);

  let data: Uint8Array;
  if (entry.compressionMethod === METHOD_STORED) {
    data = compressed;
  } else if (entry.compressionMethod === METHOD_DEFLATED) {
    data = await inflateRaw(compressed);
  } else {
    throw malformed();
  }
  if (data.length !== entry.uncompressedSize) throw malformed();
  return data;
}

async function inflateRaw(compressed: Uint8Array): Promise<Uint8Array> {
  // Re-wrap in a fresh, plain-ArrayBuffer-backed view: `compressed` is a subarray over the
  // input DataView's buffer, whose type is the wider ArrayBufferLike (it could in principle
  // wrap a SharedArrayBuffer), which Blob's stricter BlobPart type does not accept.
  const stream = new Blob([new Uint8Array(compressed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function decodeUtf8(view: DataView, start: number, length: number): string {
  return utf8Decoder.decode(new Uint8Array(view.buffer, view.byteOffset + start, length));
}

const ENTITY_PATTERN = /&amp;|&lt;|&gt;|&quot;|&apos;/g;
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/**
 * Converts a word/document.xml body into plain text. Order matters: paragraph
 * ends must become newlines before tags are stripped (once tags are gone
 * there is no `</w:p>` left to find), and entities must be decoded only after
 * tag stripping so a decoded `&lt;`/`&gt;` can never be mistaken for markup.
 */
function xmlToText(xml: string): string {
  let text = xml.replace(/<\/w:p>/g, '\n');
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(ENTITY_PATTERN, match => ENTITIES[match] ?? match);
  text = text.replace(/[ \t]+/g, ' ');
  text = text
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n');
  return text.trim();
}

// --- Voice-sample file loading helpers (shared, DOM-free; used by the options page) ---

export const VOICE_SAMPLE_CHAR_CAP = 20000;
export const MAX_VOICE_FILE_BYTES = 2 * 1024 * 1024;

const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.docx'];

/** Returns a rejection message for an unsupported file name, or null if the name is fine. */
export function checkVoiceFileName(filename: string): string | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.pdf')) {
    return 'PDF is not supported yet. Copy the text and paste it instead.';
  }
  if (!SUPPORTED_EXTENSIONS.some(ext => lower.endsWith(ext))) {
    return 'Unsupported file type. Use .txt, .md, or .docx.';
  }
  return null;
}

/** Returns a rejection message for an oversized file, or null if the size is fine. */
export function checkVoiceFileSize(sizeBytes: number): string | null {
  if (sizeBytes > MAX_VOICE_FILE_BYTES) {
    return 'That file is larger than 2 MB. Paste the text instead or use a smaller file.';
  }
  return null;
}

/** Truncates to the voice-sample cap, reporting whether truncation happened. */
export function truncateVoiceSample(text: string): { text: string; truncated: boolean } {
  if (text.length <= VOICE_SAMPLE_CHAR_CAP) return { text, truncated: false };
  return { text: text.slice(0, VOICE_SAMPLE_CHAR_CAP), truncated: true };
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** e.g. "Loaded 1,240 words from paper.docx." with a truncation note appended when relevant. */
export function formatLoadedStatus(text: string, filename: string, truncated: boolean): string {
  const words = countWords(text);
  const formattedWords = words.toLocaleString('en-US');
  const base = `Loaded ${formattedWords} word${words === 1 ? '' : 's'} from ${filename}.`;
  if (!truncated) return base;
  return `${base} Truncated to ${VOICE_SAMPLE_CHAR_CAP.toLocaleString('en-US')} characters.`;
}
