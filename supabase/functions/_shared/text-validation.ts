export function looksGarbled(text: string): boolean {
  if (text.length < 40) return false;
  const replacementCharCount = (text.match(/�/g) || []).length;
  const controlCharCount = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
  const whitespaceCount = (text.match(/\s/g) || []).length;
  const replacementRatio = replacementCharCount / text.length;
  const controlRatio = controlCharCount / text.length;
  const whitespaceRatio = whitespaceCount / text.length;
  if (replacementRatio > 0.02) return true;
  if (controlRatio > 0.01) return true;
  if (whitespaceRatio < 0.01) return true;
  return false;
}
export function isOleCompoundFile(buffer: ArrayBuffer): boolean {
  const header = new Uint8Array(buffer.slice(0, 4));
  return header[0] === 0xd0 && header[1] === 0xcf && header[2] === 0x11 && header[3] === 0xe0;
}