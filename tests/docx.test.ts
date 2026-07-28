import { describe, expect, test } from 'vitest';
import {
  checkVoiceFileName,
  checkVoiceFileSize,
  countWords,
  extractDocxText,
  formatLoadedStatus,
  MAX_DOCUMENT_XML_BYTES,
  MAX_VOICE_FILE_BYTES,
  truncateVoiceSample,
  VOICE_SAMPLE_CHAR_CAP,
} from '../src/shared/docx';

// --- ZIP fixture builder (test-only; the mirror image of the parser under test) ---
// This constructs real, spec-shaped ZIP bytes so the tests exercise the actual
// parsing and inflate paths rather than a stand-in.

interface FixtureEntry {
  name: string;
  content: Uint8Array;
  method: 0 | 8;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concatBytes(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([new Uint8Array(data)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Builds a real ZIP archive (local headers + central directory + EOCD) from the given entries. */
async function buildZip(entries: FixtureEntry[]): Promise<ArrayBuffer> {
  const fileRecords: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = new TextEncoder().encode(entry.name);
    const compressed = entry.method === 8 ? await deflateRaw(entry.content) : entry.content;
    const localHeader = concatBytes(
      u32(0x04034b50), u16(20), u16(0), u16(entry.method), u16(0), u16(0),
      u32(0), u32(compressed.length), u32(entry.content.length),
      u16(nameBytes.length), u16(0),
    );
    const record = concatBytes(localHeader, nameBytes, compressed);
    centralRecords.push(concatBytes(
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(entry.method), u16(0), u16(0),
      u32(0), u32(compressed.length), u32(entry.content.length),
      u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
      u32(offset), nameBytes,
    ));
    fileRecords.push(record);
    offset += record.length;
  }
  const centralDirStart = offset;
  const centralDir = concatBytes(...centralRecords);
  const eocd = concatBytes(
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDir.length), u32(centralDirStart), u16(0),
  );
  const full = concatBytes(...fileRecords, centralDir, eocd);
  return full.buffer;
}

async function buildDocxZip(xml: string, method: 0 | 8): Promise<ArrayBuffer> {
  return buildZip([
    { name: '[Content_Types].xml', content: new TextEncoder().encode('<Types/>'), method: 0 },
    { name: '_rels/.rels', content: new TextEncoder().encode('<Relationships/>'), method: 0 },
    { name: 'word/document.xml', content: new TextEncoder().encode(xml), method },
  ]);
}

function documentXml(...paragraphs: string[]): string {
  const body = paragraphs.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body>${body}<w:sectPr/></w:body></w:document>`
  );
}

// Fixed wrapper overhead of a single-paragraph documentXml() call, so callers can build a
// word/document.xml body of an *exact* target byte length (all fill characters are ASCII,
// so char count === byte count).
const DOCUMENT_XML_WRAPPER_BYTES = new TextEncoder().encode(documentXml('')).length;

/** Builds a real (non-lying) word/document.xml body whose UTF-8 byte length is exactly targetBytes. */
function documentXmlOfByteLength(targetBytes: number): string {
  const fillLength = targetBytes - DOCUMENT_XML_WRAPPER_BYTES;
  if (fillLength < 0) throw new Error(`targetBytes ${targetBytes} is smaller than the wrapper overhead`);
  return documentXml('A'.repeat(fillLength));
}

describe('extractDocxText: happy paths', () => {
  test('deflate-compressed word/document.xml decodes through the real inflate path (mandatory)', async () => {
    const xml = documentXml(
      'Deflate compressed text should decode correctly through the real inflate path.',
      'This paragraph has multiple sentences. Here is the second one.',
      'Final paragraph after compression.',
    );
    const zip = await buildDocxZip(xml, 8);
    const text = await extractDocxText(zip);
    expect(text).toBe(
      'Deflate compressed text should decode correctly through the real inflate path.\n' +
      'This paragraph has multiple sentences. Here is the second one.\n' +
      'Final paragraph after compression.',
    );
  });

  test('stored (uncompressed) word/document.xml is read without inflating', async () => {
    const xml = documentXml('Stored entries should pass through without inflating.', 'Second stored paragraph.');
    const zip = await buildDocxZip(xml, 0);
    const text = await extractDocxText(zip);
    expect(text).toBe('Stored entries should pass through without inflating.\nSecond stored paragraph.');
  });

  test('multiple paragraphs come back newline separated with no tags, including split runs and an empty paragraph', async () => {
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold start, </w:t></w:r><w:r><w:t>then normal text.</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t></w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Third paragraph after an empty one.</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    const zip = await buildDocxZip(xml, 8);
    const text = await extractDocxText(zip);
    expect(text).toBe('Bold start, then normal text.\nThird paragraph after an empty one.');
    expect(text).not.toMatch(/[<>]/);
  });

  test('decodes amp, lt, gt, quot, and apos entities', async () => {
    const xml = documentXml('Tom &amp; Jerry said &quot;hello&quot; &lt;there&gt; and it&apos;s fine');
    const zip = await buildDocxZip(xml, 8);
    const text = await extractDocxText(zip);
    expect(text).toBe('Tom & Jerry said "hello" <there> and it\'s fine');
  });

  test('extracted text over the cap is truncated at exactly the cap', async () => {
    const long = 'A'.repeat(VOICE_SAMPLE_CHAR_CAP + 5000);
    const xml = documentXml(long);
    const zip = await buildDocxZip(xml, 8);
    const extracted = await extractDocxText(zip);
    expect(extracted).toBe(long); // extraction itself is not capped

    const { text, truncated } = truncateVoiceSample(extracted);
    expect(truncated).toBe(true);
    expect(text.length).toBe(VOICE_SAMPLE_CHAR_CAP);
    expect(text).toBe(long.slice(0, VOICE_SAMPLE_CHAR_CAP));
  });

  test('a ZIP with a non-empty trailing archive comment still extracts correctly', async () => {
    const xml = documentXml('Trailing comment should not confuse EOCD discovery.');
    const zip = await buildDocxZip(xml, 8);
    const comment = new TextEncoder().encode('This is a trailing archive comment, unrelated to any entry.');

    // Append the comment after the EOCD record built by buildZip, then patch that record's
    // comment-length field (its last two bytes) to match, exactly as a real zip tool would.
    const withComment = new Uint8Array(zip.byteLength + comment.length);
    withComment.set(new Uint8Array(zip), 0);
    withComment.set(comment, zip.byteLength);
    const view = new DataView(withComment.buffer);
    const eocdOffset = zip.byteLength - 22;
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50); // sanity: real EOCD located pre-comment
    view.setUint16(eocdOffset + 20, comment.length, true);

    const text = await extractDocxText(withComment.buffer);
    expect(text).toBe('Trailing comment should not confuse EOCD discovery.');
  });
});

describe('extractDocxText: rejects malformed input', () => {
  test('a ZIP without word/document.xml throws the documented error', async () => {
    const zip = await buildZip([{ name: '[Content_Types].xml', content: new TextEncoder().encode('<Types/>'), method: 0 }]);
    await expect(extractDocxText(zip)).rejects.toMatchObject({
      kind: 'internal',
      message: 'Could not read that .docx file.',
    });
  });

  test('non-zip bytes throw the documented error', async () => {
    const bytes = new TextEncoder().encode('This is definitely not a zip archive, just plain text.').buffer;
    await expect(extractDocxText(bytes)).rejects.toMatchObject({
      kind: 'internal',
      message: 'Could not read that .docx file.',
    });
  });

  test('an empty buffer throws the documented error', async () => {
    await expect(extractDocxText(new ArrayBuffer(0))).rejects.toMatchObject({ kind: 'internal' });
  });

  test('a central directory claiming more entries than exist throws rather than hanging or reading garbage', async () => {
    // A single, non-matching entry: the real loop would run once, not find word/document.xml,
    // and end at the (correct) EOCD offset. Declaring extra entries forces a second iteration
    // to read a "header" starting at the EOCD itself, which must be caught by the bounds check
    // rather than reading garbage bytes or hanging.
    const zip = await buildZip([{ name: '[Content_Types].xml', content: new TextEncoder().encode('<Types/>'), method: 0 }]);
    const view = new DataView(zip);
    const eocdOffset = zip.byteLength - 22;
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50); // sanity: we found the real EOCD
    expect(view.getUint16(eocdOffset + 10, true)).toBe(1); // sanity: really only one entry exists
    view.setUint16(eocdOffset + 10, 9, true); // lie: claim 9 entries when only 1 exists
    await expect(extractDocxText(zip)).rejects.toMatchObject({
      kind: 'internal',
      message: 'Could not read that .docx file.',
    });
  });

  test('a local header offset pointing past the end of the buffer throws', async () => {
    const name = 'word/document.xml';
    const nameBytes = new TextEncoder().encode(name);
    const content = new TextEncoder().encode(documentXml('Hi.'));
    const zip = await buildZip([{ name, content, method: 0 }]);
    const view = new DataView(zip);
    const fileRecordLength = 30 + nameBytes.length + content.length; // local header + name + stored data
    const localHeaderOffsetField = fileRecordLength + 42; // field position within the single central-directory record
    view.setUint32(localHeaderOffsetField, 0xfffffff, true);
    await expect(extractDocxText(zip)).rejects.toMatchObject({ kind: 'internal' });
  });

  test('a deflate entry whose bytes are not a valid deflate-raw stream throws the documented error', async () => {
    const name = 'word/document.xml';
    const nameBytes = new TextEncoder().encode(name);
    const content = new TextEncoder().encode(documentXml('This body will be overwritten with non-inflatable bytes.'));
    const zip = await buildZip([{ name, content, method: 8 }]);
    const view = new DataView(zip);

    // Single-entry zip, so the local header starts at 0: [0,18) fixed fields, compressedSize
    // at [18,22), then LOCAL_HEADER_SIZE(30) + name bytes is where the compressed payload starts.
    const compressedSize = view.getUint32(18, true);
    const dataStart = 30 + nameBytes.length;
    expect(dataStart + compressedSize).toBeLessThanOrEqual(zip.byteLength); // sanity: region is in-bounds

    // 0xff sets DEFLATE's BFINAL=1 and BTYPE=0b11, a reserved block type the spec forbids, so
    // DecompressionStream is guaranteed to reject rather than happening to decode successfully.
    new Uint8Array(zip, dataStart, compressedSize).fill(0xff);

    await expect(extractDocxText(zip)).rejects.toMatchObject({
      kind: 'internal',
      message: 'Could not read that .docx file.',
    });
  });

  test('an EOCD declaring a central-directory offset past the end of the file throws', async () => {
    const xml = documentXml('EOCD lies about where the central directory lives.');
    const zip = await buildDocxZip(xml, 8);
    const view = new DataView(zip);
    const eocdOffset = zip.byteLength - 22;
    expect(view.getUint32(eocdOffset, true)).toBe(0x06054b50); // sanity: real EOCD located
    view.setUint32(eocdOffset + 16, zip.byteLength + 1000, true); // lie: central dir starts past EOF
    await expect(extractDocxText(zip)).rejects.toMatchObject({
      kind: 'internal',
      message: 'Could not read that .docx file.',
    });
  });
});

describe('extractDocxText: word/document.xml declared-size cap', () => {
  // Both fixtures below use a *real* (non-lying) declared size: a document.xml body that
  // genuinely is that many bytes before compression. Deflate compresses a run of a repeated
  // character to a tiny fraction of its size, so building and round-tripping these is fast even
  // though the declared/actual uncompressedSize sits right at MAX_DOCUMENT_XML_BYTES - this is
  // the same shape of archive as the reviewer's PoC (small on disk, huge once inflated), just
  // sized at the cap boundary instead of far beyond it.

  test('a document.xml one byte over the cap is rejected before decompression is attempted (mutation-verified, see report)', async () => {
    const xml = documentXmlOfByteLength(MAX_DOCUMENT_XML_BYTES + 1);
    const zip = await buildDocxZip(xml, 8);
    await expect(extractDocxText(zip)).rejects.toMatchObject({
      kind: 'internal',
      message: 'Could not read that .docx file.',
    });
  });

  test('a document.xml exactly at the cap still extracts (off-by-one guard)', async () => {
    const xml = documentXmlOfByteLength(MAX_DOCUMENT_XML_BYTES);
    expect(new TextEncoder().encode(xml).length).toBe(MAX_DOCUMENT_XML_BYTES); // sanity: fixture hits the boundary exactly
    const zip = await buildDocxZip(xml, 8);
    const text = await extractDocxText(zip);
    expect(text.length).toBe(MAX_DOCUMENT_XML_BYTES - DOCUMENT_XML_WRAPPER_BYTES);
    expect(text.startsWith('A')).toBe(true);
    expect(text.endsWith('A')).toBe(true);
  });
});

describe('voice-file helpers', () => {
  test('checkVoiceFileSize allows exactly the cap and rejects one byte over it', () => {
    expect(checkVoiceFileSize(MAX_VOICE_FILE_BYTES)).toBeNull();
    expect(checkVoiceFileSize(MAX_VOICE_FILE_BYTES + 1)).toBe(
      'That file is larger than 2 MB. Paste the text instead or use a smaller file.',
    );
  });

  test('checkVoiceFileName gives the specific PDF message and accepts txt, md, docx', () => {
    expect(checkVoiceFileName('paper.pdf')).toBe('PDF is not supported yet. Copy the text and paste it instead.');
    expect(checkVoiceFileName('PAPER.PDF')).toBe('PDF is not supported yet. Copy the text and paste it instead.');
    expect(checkVoiceFileName('notes.docx')).toBeNull();
    expect(checkVoiceFileName('notes.txt')).toBeNull();
    expect(checkVoiceFileName('notes.md')).toBeNull();
    expect(checkVoiceFileName('notes.rtf')).toBe('Unsupported file type. Use .txt, .md, or .docx.');
  });

  test('truncateVoiceSample leaves text at or under the cap untouched', () => {
    const atCap = 'x'.repeat(VOICE_SAMPLE_CHAR_CAP);
    expect(truncateVoiceSample(atCap)).toEqual({ text: atCap, truncated: false });
    expect(truncateVoiceSample('short')).toEqual({ text: 'short', truncated: false });
  });

  test('countWords counts whitespace-separated words and treats blank text as zero', () => {
    expect(countWords('One two three')).toBe(3);
    expect(countWords('  spaced   out   words  ')).toBe(3);
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });

  test('formatLoadedStatus reports a comma-formatted word count and notes truncation', () => {
    const text = Array.from({ length: 1240 }, () => 'word').join(' ');
    expect(formatLoadedStatus(text, 'paper.docx', false)).toBe('Loaded 1,240 words from paper.docx.');
    expect(formatLoadedStatus('one', 'notes.txt', false)).toBe('Loaded 1 word from notes.txt.');
    expect(formatLoadedStatus(text, 'paper.docx', true)).toBe(
      'Loaded 1,240 words from paper.docx. Truncated to 20,000 characters.',
    );
  });
});
