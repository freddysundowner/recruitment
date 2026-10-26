import net from "node:net";

/**
 * Upload safety. Two checks:
 *  1. The file's first bytes must match what it claims to be, so an .exe renamed to .pdf is refused.
 *  2. If CLAMAV_HOST is set, the file is streamed to ClamAV (clamd). Set CLAMAV_REQUIRED=true to
 *     refuse uploads whenever the scanner cannot be reached.
 */
const SIGNATURES: Record<string, number[]> = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // %PDF
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47],
};

export function matchesType(bytes: Buffer, mime: string): boolean {
  const sig = SIGNATURES[mime];
  return Boolean(sig) && sig.every((b, i) => bytes[i] === b);
}

function clamScan(bytes: Buffer, host: string, port: number): Promise<"clean" | "infected"> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    let out = "";
    sock.setTimeout(15_000, () => sock.destroy(new Error("ClamAV timed out")));
    sock.on("error", reject);
    sock.on("data", (d) => (out += d.toString()));
    sock.on("end", () => (/FOUND/.test(out) ? resolve("infected") : /OK/.test(out) ? resolve("clean") : reject(new Error(`ClamAV said: ${out.trim()}`))));
    sock.on("connect", () => {
      sock.write("zINSTREAM\0");
      for (let i = 0; i < bytes.length; i += 64 * 1024) {
        const chunk = bytes.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(chunk.length);
        sock.write(len);
        sock.write(chunk);
      }
      sock.write(Buffer.alloc(4));
    });
  });
}

/** Returns an error message if the upload must be refused, or null when it is fine. */
export async function checkUpload(bytes: Buffer, mime: string): Promise<string | null> {
  if (!matchesType(bytes, mime)) return "The file's contents do not match its type. Upload a real PDF, JPG or PNG.";
  const host = process.env.CLAMAV_HOST;
  if (!host) return null;
  try {
    const r = await clamScan(bytes, host, Number(process.env.CLAMAV_PORT ?? 3310));
    return r === "infected" ? "The file was rejected by the virus scanner." : null;
  } catch (e) {
    console.error("ClamAV unavailable:", e);
    return process.env.CLAMAV_REQUIRED === "true" ? "The virus scanner is unavailable, so uploads are paused. Try again shortly." : null;
  }
}
