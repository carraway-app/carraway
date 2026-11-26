/** Browser und Betriebssystem aus dem User-Agent einer Sitzung, grob und nur zur Anzeige; ohne Treffer `null`. */
export function geraetAus(userAgent: string | null): { browser: string; system: string } | null {
  if (!userAgent) return null;
  const ua = userAgent;
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\/|FxiOS\//.test(ua) ? "Firefox" : /Chrome\/|CriOS\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const system = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : null;
  if (!browser && !system) return null;
  return { browser: browser ?? "Browser", system: system ?? "?" };
}
