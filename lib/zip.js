// lib/zip.js - Minimal ZIP (store) generator with CRC32

const textEncoder = new TextEncoder();

// Precompute CRC32 table
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ bytes[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2); // DOS stores seconds/2

  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  return { dosDate, dosTime };
}

function writeUint16LE(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32LE(view, offset, value) {
  view.setUint32(offset, value, true);
}

function concatChunks(chunks, totalLength) {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function stringToBytes(str) {
  return textEncoder.encode(str);
}

/**
 * Create a ZIP (store, no compression) from entries
 * entries: Array<{ name: string, data: Uint8Array }>
 * returns Uint8Array of zip file
 */
export function zipEntries(entries) {
  const chunks = [];
  const centralDir = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = stringToBytes(entry.name);
    const data = entry.data || new Uint8Array();
    const crc = crc32(data);
    const { dosDate, dosTime } = dosDateTime();

    // Local file header
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lhView = new DataView(localHeader.buffer);
    writeUint32LE(lhView, 0, 0x04034b50);
    writeUint16LE(lhView, 4, 20); // version needed
    writeUint16LE(lhView, 6, 0);  // flags
    writeUint16LE(lhView, 8, 0);  // method: store
    writeUint16LE(lhView, 10, dosTime);
    writeUint16LE(lhView, 12, dosDate);
    writeUint32LE(lhView, 14, crc);
    writeUint32LE(lhView, 18, data.length);
    writeUint32LE(lhView, 22, data.length);
    writeUint16LE(lhView, 26, nameBytes.length);
    writeUint16LE(lhView, 28, 0); // extra len
    localHeader.set(nameBytes, 30);

    chunks.push(localHeader, data);

    // Central directory header
    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cdHeader.buffer);
    writeUint32LE(cdView, 0, 0x02014b50);
    writeUint16LE(cdView, 4, 20); // version made by
    writeUint16LE(cdView, 6, 20); // version needed
    writeUint16LE(cdView, 8, 0);  // flags
    writeUint16LE(cdView, 10, 0); // method
    writeUint16LE(cdView, 12, dosTime);
    writeUint16LE(cdView, 14, dosDate);
    writeUint32LE(cdView, 16, crc);
    writeUint32LE(cdView, 20, data.length);
    writeUint32LE(cdView, 24, data.length);
    writeUint16LE(cdView, 28, nameBytes.length);
    writeUint16LE(cdView, 30, 0); // extra len
    writeUint16LE(cdView, 32, 0); // comment len
    writeUint16LE(cdView, 34, 0); // disk number
    writeUint16LE(cdView, 36, 0); // internal attr
    writeUint32LE(cdView, 38, 0); // external attr
    writeUint32LE(cdView, 42, offset);
    cdHeader.set(nameBytes, 46);

    centralDir.push(cdHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirSize = centralDir.reduce((sum, c) => sum + c.length, 0);
  const centralDirOffset = offset;

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  writeUint32LE(endView, 0, 0x06054b50);
  writeUint16LE(endView, 4, 0); // disk number
  writeUint16LE(endView, 6, 0); // disk where central dir starts
  writeUint16LE(endView, 8, entries.length);
  writeUint16LE(endView, 10, entries.length);
  writeUint32LE(endView, 12, centralDirSize);
  writeUint32LE(endView, 16, centralDirOffset);
  writeUint16LE(endView, 20, 0); // comment len

  const totalLength = offset + centralDirSize + endRecord.length;
  return concatChunks([...chunks, ...centralDir, endRecord], totalLength);
}

export function strToUint8(str) {
  return stringToBytes(str);
}
