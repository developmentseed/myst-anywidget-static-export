// Base64 → ArrayBuffer and a port of put_buffers from
// @jupyter-widgets/base/src/utils.ts. Splices DataView instances into a state
// object at the addressed paths, mutating state in place.

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin =
    typeof atob === "function"
      ? atob(b64)
      : Buffer.from(b64, "base64").toString("binary");
  const len = bin.length;
  const buf = new ArrayBuffer(len);
  const view = new Uint8Array(buf);
  for (let i = 0; i < len; i++) view[i] = bin.charCodeAt(i);
  return buf;
}

export function putBuffers(
  state: any,
  bufferPaths: (string | number)[][],
  buffers: (ArrayBuffer | DataView | { buffer: ArrayBuffer })[],
): void {
  for (let i = 0; i < bufferPaths.length; i++) {
    const path = bufferPaths[i];
    let buf: any = buffers[i];
    if (!(buf instanceof DataView)) {
      buf = new DataView(buf instanceof ArrayBuffer ? buf : buf.buffer);
    }
    let obj = state;
    for (let j = 0; j < path.length - 1; j++) obj = obj[path[j]];
    obj[path[path.length - 1]] = buf;
  }
}

export interface BufferRecord {
  path: (string | number)[];
  data: string;
}

export function applyBuffers(state: any, buffersList: BufferRecord[]): void {
  if (!buffersList || buffersList.length === 0) return;
  const paths = buffersList.map((b) => b.path);
  const arrayBuffers = buffersList.map((b) => base64ToArrayBuffer(b.data));
  putBuffers(state, paths, arrayBuffers);
}
