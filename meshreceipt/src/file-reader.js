import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';

// Keep bounded file I/O independent of model decoders and signature libraries.
export async function readBoundedFile(file, limit) {
  const before = await lstat(file);
  if (!before.isFile() || before.size <= 0 || before.size > limit) throw new Error('File type/size outside bundle bounds');
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > limit) throw new Error('File size outside bundle bounds');
    if (info.dev !== before.dev || info.ino !== before.ino) throw new Error('File changed before bundle read');
    const buffer = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    if (offset !== info.size) throw new Error('File changed during bundle read');
    return buffer.subarray(0, offset);
  } finally { await handle.close(); }
}
