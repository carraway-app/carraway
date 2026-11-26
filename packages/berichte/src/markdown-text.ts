/**
 * Freitexte der Belegvorlagen (Kopf- und Fußtext) sind Markdown. Im PDF erscheinen sie als einfacher Text: Auszeichnung (fett, kursiv,
 * Code, Überschriften, Zitate) entfällt, Listenpunkte bleiben als „- “, Links stehen als „Text (Adresse)“, Bilder als Alternativtext.
 * Der Text geht danach als Zeichenkette in das PDF und wird nie als Auszeichnung gelesen, so bleibt die Ausgabe vorhersagbar.
 */
export function markdownZuText(text: string): string {
  const aus: string[] = [];
  let imCode = false;
  for (const roh of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s{0,3}(```|~~~)/.test(roh)) {
      imCode = !imCode;
      continue;
    }
    if (imCode) {
      aus.push(roh);
      continue;
    }
    let z = roh
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/\s+#+\s*$/, "")
      .replace(/^(\s*>)+\s?/, "")
      .replace(/^(\s*)[*+]\s+/, "$1- ");
    // Maskierte Zeichen (\*) vor der Auszeichnung wegnehmen und am Ende wieder einsetzen.
    z = z
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, (_m, c: string) => String.fromCharCode(0xe000 + c.charCodeAt(0)))
      .replace(/!\[([^\]]*)\]\([^)\s]*[^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, (_m, t: string, u: string) => (t === u ? u : `${t} (${u})`))
      .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
      .replace(/(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?!\*)/g, "$1")
      .replace(/(?<!\w)_(?=[^\s_])(.+?)(?<=[^\s_])_(?!\w)/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/[\ue000-\ue0ff]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xe000));
    aus.push(z);
  }
  return aus.join("\n").trim();
}
