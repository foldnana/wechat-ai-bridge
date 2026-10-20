export type WechatQr = { kind: "image" | "link"; value: string };

/** Do not turn missing data, placeholder text or a reserved test URL into a login QR. */
export function parseWechatQr(input: string): WechatQr | null {
  const value = input.trim();
  if (/^data:image\/(?:png|jpeg|gif|webp|svg\+xml)[;,].+/i.test(value)) {
    return { kind: "image", value };
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      /(^|\.)(invalid|example|test|localhost)$/.test(url.hostname) ||
      /^(www\.)?example\.(com|net|org)$/.test(url.hostname)
    )
      return null;
    return {
      kind: /\.(png|jpe?g|gif|webp|svg)$/i.test(url.pathname)
        ? "image"
        : "link",
      value,
    };
  } catch {
    return null;
  }
}
