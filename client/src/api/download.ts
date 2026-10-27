// Files the API sends as downloads (PDF reports): the name the server suggests, and saving the file in the browser.
// The request itself goes through `api.download` (client.ts), with the same headers and errors as every other call.

/** A downloaded file and the name the server suggested for it (null when it didn't). */
export interface DownloadedFile {
  blob: Blob;
  filename: string | null;
}

/** `name=value` parameters of a header (`value` quoted or not); the header's leading `attachment` has no `=`. */
const HEADER_PARAM = /;\s*([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g;

/** An RFC 8187 extended value: charset'language'percent-encoded. */
const EXT_VALUE = /^([!#$%&+^_`{}~0-9A-Za-z-]+)'[^']*'(.*)$/;

function decodeExtValue(value: string): string | null {
  const match = EXT_VALUE.exec(value.trim());
  if (!match) return null;
  const charset = match[1]!.toLowerCase();
  const encoded = match[2]!;
  try {
    switch (charset) {
      case 'utf-8':
        return decodeURIComponent(encoded);
      case 'iso-8859-1':
        return encoded.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      default:
        return null;
    }
  } catch {
    return null; // malformed percent-encoding
  }
}

/** The name without any folder part or control characters; null when nothing is left. */
function cleanFilename(name: string): string | null {
  const base = name.split(/[/\\]/).pop()!.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return base && base !== '.' && base !== '..' ? base : null;
}

/**
 * The file name in a `Content-Disposition` header: `filename*` (UTF-8, percent-encoded) when present and readable,
 * otherwise `filename` (quoted or not). Null when there is none.
 */
export function filenameFromContentDisposition(header: string | null | undefined): string | null {
  if (!header) return null;
  let plain: string | null = null;
  let extended: string | null = null;
  for (const match of `;${header}`.matchAll(HEADER_PARAM)) {
    const name = match[1]!.toLowerCase();
    const value = match[2] !== undefined ? match[2].replace(/\\(.)/g, '$1') : match[3]!.trim();
    if (name === 'filename*' && extended === null) extended = decodeExtValue(value);
    else if (name === 'filename' && plain === null) plain = value;
  }
  return (extended !== null ? cleanFilename(extended) : null) ?? (plain !== null ? cleanFilename(plain) : null);
}

/** How long a saved file's object URL is kept: some browsers start the download after the click returns. */
const REVOKE_AFTER_MS = 40_000;

/** Saves `blob` as a download named `filename`, through a temporary object URL and `<a download>`. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
