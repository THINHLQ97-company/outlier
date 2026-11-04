// Resolve once, reject the entire answer set if any address is non-public,
// then pin the validated IP in lookup. No second DNS lookup at connect time.
import { lookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { isIP } from "node:net";

export function isPublicImageIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (isIP(ip) !== 6) return false;
  // Only native global unicast 2000::/3; deny special-purpose 2001::/23,
  // documentation, 6to4, mapped/compatible IPv4, ULA/link-local/multicast.
  const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const first = parseInt(normalized.split(":")[0], 16);
  const second = parseInt(normalized.split(":")[1] || "0", 16);
  return first >= 0x2000 && first <= 0x3fff &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
    first !== 0x2002 && !(first === 0x3fff && second <= 0xfff);
}
export interface TransportDeps {
  resolve(host: string): Promise<{ address: string; family: number }[]>;
  connect(url: URL, options: RequestOptions, signal: AbortSignal): Promise<IncomingMessage>;
}
const transport: TransportDeps = {
  resolve: host => lookup(host, { all: true, verbatim: true }),
  connect(url, options, signal) {
    return new Promise((resolve, reject) => {
      const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, { ...options, signal }, resolve);
      req.on("error", reject);
      req.end();
    });
  },
};
export async function requestPinnedImage(raw: string, signal: AbortSignal, deps: TransportDeps = transport): Promise<IncomingMessage> {
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      (url.port && !["80", "443"].includes(url.port))) throw Error("Unsupported image URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // DNS has no native AbortSignal. Race it against the same absolute deadline.
  const addresses = await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
    const abort = () => reject(Error("Image request aborted"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    const answer = isIP(host) ? Promise.resolve([{ address: host, family: isIP(host) }]) : deps.resolve(host);
    answer.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  if (!addresses.length || addresses.some(a => !isPublicImageIp(a.address) || isIP(a.address) !== a.family)) throw Error("Non-public image address");
  if (signal.aborted) throw Error("Image request aborted");
  const pinned = addresses[0];
  return deps.connect(url, {
    family: pinned.family,
    agent: false, // Never reuse a socket created outside this validation.
    servername: isIP(host) ? undefined : host,
    headers: { Accept: "image/*", Host: url.host },
    lookup: ((_hostname: string, options: { all?: boolean }, callback: Function) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family)) as RequestOptions["lookup"],
  }, signal);
}
