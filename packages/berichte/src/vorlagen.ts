/** Gemeinsamer Satz für Berichte und Belege. Die Daten stehen als Typst-Literal vor der Vorlage. */
// Die Typst-Quelle enthält das Zeichen auch bei einem eigenen Schriftenordner.
const ZEICHEN = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Carraway">
  <path d="M54.034 15.609A25.5 25.5 0 1 0 54.034 48.391" fill="none" stroke="#18211d" stroke-width="6"/>
  <path d="M45.608 22.68A14.5 14.5 0 1 0 45.608 41.32" fill="none" stroke="#18211d" stroke-width="6"/>
  <circle cx="34.5" cy="32" r="6.5" fill="#096d69"/>
</svg>`;

const GRUNDLAGE = String.raw`
#let basalt = rgb("#18211d")
#let diagramm-ink = rgb("#0a0b0d")
#let diagramm-grau = rgb("#575c64")
#let diagramm-linie = rgb("#d8d5ce")
#let kalk = rgb("#edf3ec")
#let messing = rgb("#a38b59")
#let grau = rgb("#505e56")
#let linie = rgb("#d3d9d3")
#let u = 8pt
#let mono = "IBM Plex Mono"
#let anzeige = "Instrument Sans"

#set document(title: data.titel, author: "Carraway")
#set text(font: anzeige, size: 9pt, fill: basalt, lang: data.sprache, region: if data.sprache == "de" { "DE" } else { "GB" })
#set par(leading: 0.6em)
#set page(
  paper: "a4",
  margin: (x: 6 * u, top: 10 * u, bottom: 8 * u),
  header-ascent: 2 * u,
  footer-descent: 1 * u,
  fill: white,
  background: if data.entwurf { place(center + horizon, rotate(-35deg, text(font: anzeige, weight: 700, size: 120pt, fill: basalt.transparentize(94%), tracking: 0.05em, data.t.wasserzeichen))) } else { none },
  header: [
    #grid(
      columns: (1fr, auto),
      align: (left + horizon, right + horizon),
      grid(columns: (auto, auto), column-gutter: 4pt, align: horizon,
        image(bytes(${JSON.stringify(ZEICHEN)}), format: "svg", width: 16pt),
        text(font: anzeige, weight: 650, size: 11pt, tracking: -0.02em)[Carraway],
      ),
      text(font: mono, size: 7pt, fill: grau, tracking: 0.1em, upper(data.kopf)),
    )
    #v(0.5 * u)
    #line(length: 100%, stroke: 2pt + messing)
  ],
  footer: context [
    #line(length: 100%, stroke: 0.5pt + linie)
    #v(0.5 * u)
    #set text(font: mono, size: 7pt, fill: grau)
    #grid(
      columns: (1fr, auto),
      [#if data.entwurf [#data.t.wasserzeichen] else [#data.t.freigegeben] · #data.t.stichtag #data.stichtag · #data.t.wissensstand #data.wissensstand],
      [#data.t.seite #counter(page).display() #data.t.von #counter(page).final().first()],
    )
  ],
)

#let beschriftung(x) = text(font: mono, size: 6.5pt, tracking: 0.12em, fill: grau, upper(x))

#let abschnitt(titel) = {
  v(1 * u)
  text(font: anzeige, weight: 700, size: 13pt)[#titel]
  v(0.5 * u)
}

#let kachel(label, wert, hinweis: none, dunkel: false) = block(
  fill: if dunkel { rgb("#163b33") } else { kalk },
  radius: 4pt,
  inset: (x: 1.5 * u, y: 2 * u),
  width: 100%,
  {
    set text(fill: if dunkel { rgb("#eef3ee") } else { basalt })
    text(font: mono, size: 6.5pt, tracking: 0.12em, fill: if dunkel { rgb("#b9cfc4") } else { grau }, upper(label))
    v(0.5 * u)
    text(font: anzeige, weight: 700, size: 16pt)[#wert]
    if hinweis != none {
      linebreak()
      text(size: 7pt, fill: if dunkel { rgb("#b9cfc4") } else { grau })[#hinweis]
    }
  },
)

#let tabelle(kopf, zeilen, ausrichtung, spalten) = table(
  columns: spalten,
  align: (col, row) => ausrichtung.at(col),
  inset: (x: 0.5 * u, y: 0.5 * u),
  stroke: (x, y) => if y == 0 { (bottom: 0.75pt + basalt) } else { (bottom: 0.5pt + linie) },
  table.header(..kopf.map(k => beschriftung(k))),
  ..zeilen.map(z => z.enumerate().map(((i, c)) => if ausrichtung.at(i) == right { text(font: mono, size: 7.5pt)[#c] } else { text(size: 8pt)[#c] })).flatten(),
)

#let breiten-aus(b) = b.map(w => if w == none { auto } else { w * 1fr })
#let ausrichtung-aus(a) = a.map(x => if x == "right" { right } else { left })

// Tabelle mit Spalten aus den Daten; optional ist die letzte Zeile eine Summenzeile (fett, mit Linie darüber).
#let tabelle2(kopf, zeilen, ausrichtung, breiten, summe: false) = {
  let ausr = ausrichtung-aus(ausrichtung)
  let n = zeilen.len()
  table(
    columns: breiten-aus(breiten),
    align: (col, row) => ausr.at(col),
    inset: (x: 0.5 * u, y: 0.5 * u),
    stroke: (x, y) => if y == 0 { (bottom: 0.75pt + basalt) } else if summe and y == n { (top: 0.75pt + basalt, bottom: 0.5pt + linie) } else { (bottom: 0.5pt + linie) },
    table.header(..kopf.map(k => beschriftung(k))),
    ..zeilen.enumerate().map(((r, z)) => z.enumerate().map(((i, c)) => {
      let fett = summe and r == n - 1
      if ausr.at(i) == right { text(font: mono, size: 7.5pt, weight: if fett { "bold" } else { "regular" })[#c] } else { text(size: 8pt, weight: if fett { "bold" } else { "regular" })[#c] }
    })).flatten(),
  )
}

#let absaetze(liste) = for a in liste [#a #parbreak()]

#let balken(werte, hoehe: 12 * u) = {
  if werte.len() == 0 { return }
  let m = calc.max(..werte.map(w => w.v))
  grid(
    columns: werte.map(_ => 1fr),
    column-gutter: 0.5 * u,
    ..werte.map(w => block(height: hoehe + 5 * u, width: 100%, align(bottom + center, stack(
      dir: ttb,
      spacing: 3pt,
      text(font: mono, size: 6pt, fill: grau)[#w.beschriftung],
      rect(width: 100%, height: if m > 0 { calc.max(1pt, hoehe * w.v / m) } else { 1pt }, fill: if w.letzte { diagramm-ink } else { rgb("#9a9ea5") }),
      text(font: mono, size: 6pt, fill: grau)[#w.etikett],
    )))),
  )
}

#let herkunftsliste(eintraege) = for e in eintraege {
  block(breakable: false, width: 100%, inset: (y: 0.5 * u), stroke: (bottom: 0.5pt + linie), {
    grid(
      columns: (1fr, auto),
      text(font: anzeige, weight: 700, size: 10pt)[#e.name],
      text(font: mono, size: 9pt)[#e.wert],
    )
    v(0.25 * u)
    for s in e.schritte {
      grid(
        columns: (1.5 * u, 1fr, auto),
        text(font: mono, size: 7.5pt, fill: grau)[#s.zeichen],
        text(size: 8pt)[#s.bezeichnung],
        text(font: mono, size: 7.5pt)[#s.wert],
      )
    }
  })
}
`;

export const QUARTALSBERICHT = String.raw`
#text(font: anzeige, weight: 700, size: 26pt, tracking: -0.01em)[#upper(data.organisation)]
#linebreak()
#text(size: 10pt, fill: grau)[#data.untertitel]
#v(2 * u)
#grid(columns: (1fr, 1fr, 1fr), column-gutter: u, row-gutter: u, ..data.kacheln.map(k => kachel(k.label, k.wert, hinweis: k.hinweis, dunkel: k.dunkel)))
#let sektionen = (
  bewertungsverlauf: () => [
    #abschnitt(data.t.quartalsbericht.bewertungsverlauf)
    #if data.balken.len() == 0 [#text(fill: grau)[#data.t.quartalsbericht.keinVerlauf]] else [#balken(data.balken)]
  ],
  vorgaenge: () => [
    #abschnitt(data.vorgaengeTitel)
    #if data.vorgaenge.len() == 0 [#text(fill: grau)[#data.t.quartalsbericht.keineVorgaenge]] else [
      #tabelle(data.vorgaengeKopf, data.vorgaenge, (left, left, right, left), (auto, auto, auto, 1fr))
      #if data.weitere != "" [#text(size: 7.5pt, fill: grau)[#data.weitere]]
    ]
  ],
  unternehmenskennzahlen: () => [
    #abschnitt(data.t.quartalsbericht.unternehmenskennzahlen)
    #if data.unternehmenskennzahlen.len() == 0 [#text(fill: grau)[#data.t.quartalsbericht.keineUnternehmenskennzahlen]] else [
      #tabelle(data.unternehmenskennzahlenKopf, data.unternehmenskennzahlen, (left, left, right, right, right), (1fr, auto, auto, auto, auto))
      #text(size: 7pt, fill: grau)[#data.t.quartalsbericht.unternehmenskennzahlenHinweis]
    ]
  ],
)
#for k in data.abschnitte { sektionen.at(k)() }
#v(1fr)
#block(width: 100%, breakable: false, inset: (y: 1 * u), stroke: (top: 0.5pt + linie), {
  set text(size: 7pt, fill: grau)
  text(font: mono, size: 6.5pt, tracking: 0.12em)[#upper(data.t.quartalsbericht.herkunft)]
  linebreak()
  data.t.quartalsbericht.herkunftText
  linebreak()
  data.t.quartalsbericht.multipleRechnung + ": " + data.multipleRechnung
  linebreak()
  data.t.quartalsbericht.irrRechnung
})
`;

export const FONDSBERICHT = String.raw`
#v(6 * u)
#beschriftung(data.t.fondsbericht.titel)
#v(1 * u)
#text(font: anzeige, weight: 700, size: 44pt, tracking: -0.02em)[#upper(data.fonds)]
#v(1 * u)
#text(size: 13pt, fill: grau)[#data.untertitel]
#v(4 * u)
#grid(columns: (1fr, 1fr), column-gutter: u, row-gutter: u,
  kachel(data.t.stichtag, data.stichtag),
  kachel(data.t.wissensstand, data.wissensstand),
  kachel(data.t.kennzahlen.zeichnungskapital, data.zeichnungskapital),
  kachel(data.t.fondsbericht.anzahlBeteiligungen, data.anzahlBeteiligungen),
)
#v(4 * u)
#if data.entwurf [#text(size: 9pt, fill: grau)[#data.t.entwurfHinweis]]
#pagebreak()

#let sektionen = (
  kennzahlen: () => [
    #abschnitt(data.t.fondsbericht.kennzahlen)
    #grid(columns: (1fr, 1fr, 1fr, 1fr), column-gutter: u, row-gutter: u, ..data.kacheln.map(k => kachel(k.label, k.wert, dunkel: k.dunkel)))
  ],
  portfolio: () => [
    #abschnitt(data.t.fondsbericht.portfolio)
    #tabelle2(data.portfolioKopf, data.portfolio, data.portfolioAusrichtung, data.portfolioBreiten)
    #v(0.5 * u)
    #for h in data.portfolioHinweise [#text(size: 7pt, fill: grau)[#h] #linebreak()]
  ],
  realisierungen: () => [
    #abschnitt(data.t.fondsbericht.realisierungen)
    #if data.realisierungen.len() == 0 [#text(fill: grau)[#data.t.fondsbericht.keineRealisierungen]] else [
      #tabelle(data.realisierungenKopf, data.realisierungen, (left, left, right, right, right), (1fr, auto, auto, auto, auto))
    ]
  ],
  herkunft: () => [
    #pagebreak(weak: true)
    #abschnitt(data.t.fondsbericht.herkunft)
    #text(size: 8pt, fill: grau)[#data.t.fondsbericht.herkunftEinleitung]
    #v(1 * u)
    #herkunftsliste(data.herkunft)
  ],
)
#for k in data.abschnitte { sektionen.at(k)() }
`;

export const LP_BERICHT = String.raw`
#v(6 * u)
#beschriftung(data.t.lp.titel)
#v(1 * u)
#text(font: anzeige, weight: 700, size: 44pt, tracking: -0.02em)[#upper(data.fonds)]
#v(1 * u)
#text(size: 13pt, fill: grau)[#data.untertitel]
#v(4 * u)
#grid(columns: (1fr, 1fr), column-gutter: u, row-gutter: u,
  kachel(data.t.stichtag, data.stichtag),
  kachel(data.t.wissensstand, data.wissensstand),
  kachel(data.t.kennzahlen.zeichnungskapital, data.zeichnungskapital),
  kachel(data.t.fondsbericht.anzahlBeteiligungen, data.anzahlBeteiligungen),
)
#v(4 * u)
#if data.entwurf [#text(size: 9pt, fill: grau)[#data.t.entwurfHinweis]]
#pagebreak()

#let freitext(k) = () => {
  let f = data.freitexte.at(k)
  if f.absaetze.len() > 0 or data.entwurf {
    abschnitt(f.titel)
    if f.absaetze.len() == 0 { text(fill: grau)[#data.t.lp.keinText] } else { absaetze(f.absaetze) }
  }
}

#let sektionen = (
  vorwort: freitext("vorwort"),
  marktumfeld: freitext("marktumfeld"),
  ausblick: freitext("ausblick"),
  kennzahlen: () => [
    #abschnitt(data.t.fondsbericht.kennzahlen)
    #grid(columns: (1fr, 1fr, 1fr, 1fr), column-gutter: u, row-gutter: u, ..data.kacheln.map(k => kachel(k.label, k.wert, dunkel: k.dunkel)))
  ],
  kapitalkonten: () => [
    #abschnitt(data.t.lp.kapitalkonten)
    #text(size: 8pt, fill: grau)[#data.kapitalkontenHinweis]
    #v(0.5 * u)
    #if data.zahlungen.len() > 0 [#tabelle2(data.zahlungenKopf, data.zahlungen, ("left", "right", "right", "right", "right"), (1, none, none, none, none))]
    #tabelle2(data.kapitalkontenKopf, data.kapitalkonten, data.kapitalkontenAusrichtung, data.kapitalkontenBreiten, summe: data.kapitalkontenSumme)
  ],
  portfolio: () => [
    #abschnitt(data.t.fondsbericht.portfolio)
    #tabelle2(data.portfolioKopf, data.portfolio, data.portfolioAusrichtung, data.portfolioBreiten)
    #v(0.5 * u)
    #for h in data.portfolioHinweise [#text(size: 7pt, fill: grau)[#h] #linebreak()]
  ],
  realisierungen: () => [
    #abschnitt(data.t.fondsbericht.realisierungen)
    #if data.realisierungen.len() == 0 [#text(fill: grau)[#data.t.fondsbericht.keineRealisierungen]] else [
      #tabelle(data.realisierungenKopf, data.realisierungen, (left, left, right, right, right), (1fr, auto, auto, auto, auto))
    ]
  ],
  bewertung: () => [
    #abschnitt(data.t.lp.bewertung)
    #text(size: 8pt, fill: grau)[#data.t.lp.bewertungHinweis]
    #v(0.5 * u)
    #tabelle2(data.bewertungKopf, data.bewertung, data.bewertungAusrichtung, data.bewertungBreiten, summe: true)
  ],
  herkunft: () => [
    #pagebreak(weak: true)
    #abschnitt(data.t.fondsbericht.herkunft)
    #text(size: 8pt, fill: grau)[#data.t.fondsbericht.herkunftEinleitung]
    #v(1 * u)
    #herkunftsliste(data.herkunft)
  ],
)
#for k in data.abschnitte { sektionen.at(k)() }
`;

export const LISTE = String.raw`
#set page(flipped: true)
#beschriftung(data.kopf)
#v(0.5 * u)
#text(font: anzeige, weight: 700, size: 26pt, tracking: -0.01em)[#upper(data.titelText)]
#linebreak()
#text(size: 10pt, fill: grau)[#data.untertitel]
#v(1 * u)
#grid(columns: (1fr, 1fr, 1fr), column-gutter: u,
  kachel(data.t.fonds, data.fonds),
  kachel(data.t.stichtag, data.stichtag),
  kachel(data.t.betraegeIn, data.einheit),
)
#v(1 * u)
#if data.zeilen.len() == 0 [#text(fill: grau)[#data.keine]] else [
  #tabelle2(data.spaltenKopf, data.zeilen, data.ausrichtung, data.breiten, summe: true)
  #v(0.5 * u)
  #for h in data.hinweise [#text(size: 7pt, fill: grau)[#h] #linebreak()]
]
`;

export const GREMIENVORLAGE = String.raw`
#beschriftung(data.t.gremien.titel)
#v(0.5 * u)
#text(font: anzeige, weight: 700, size: 26pt, tracking: -0.01em)[#upper(data.t.gremien.titel)]
#linebreak()
#text(size: 10pt, fill: grau)[#data.untertitel]
#v(1 * u)
#grid(columns: (1fr, 1fr), column-gutter: u,
  kachel(data.t.gremien.anzahl, data.anzahl),
  kachel(data.t.stichtag, data.stichtag),
)
#v(1 * u)

#let sektionen = (
  deals: () => [
    #if data.deals.len() == 0 [#text(fill: grau)[#data.t.gremien.keineDeals]]
    #for d in data.deals {
      block(breakable: false, width: 100%, fill: kalk, radius: 4pt, inset: 2 * u, below: u, {
        grid(
          columns: (1fr, auto),
          text(font: anzeige, weight: 700, size: 12pt)[#d.titel],
          text(font: mono, size: 8pt)[#d.ticket],
        )
        v(0.25 * u)
        beschriftung(data.t.gremien.eckdaten)
        v(0.25 * u)
        grid(columns: (auto, 1fr, auto, 1fr), column-gutter: u, row-gutter: 0.25 * u,
          ..d.eckdaten.map(e => (text(size: 7pt, fill: grau)[#e.at(0)], text(size: 8pt)[#e.at(1)])).flatten())
        v(0.5 * u)
        beschriftung(data.t.gremien.beschlussvorschlag)
        v(0.25 * u)
        if d.vorschlag == none {
          text(size: 8pt, fill: grau)[#data.t.gremien.keinVorschlag]
        } else {
          text(size: 8pt)[#d.vorschlag.text]
          if d.vorschlag.hinweis != "" { linebreak(); text(size: 7pt, fill: grau)[#d.vorschlag.hinweis] }
        }
        v(0.5 * u)
        beschriftung(data.t.gremien.beschluesse)
        v(0.25 * u)
        if d.beschluesse.len() == 0 {
          text(size: 8pt, fill: grau)[#data.t.gremien.keinBeschluss]
        } else {
          for b in d.beschluesse {
            text(size: 8pt)[#b.text]
            linebreak()
          }
        }
        v(0.5 * u)
        beschriftung(data.t.gremien.aktivitaeten)
        v(0.25 * u)
        if d.aktivitaeten.len() == 0 {
          text(size: 8pt, fill: grau)[#data.t.gremien.keineAktivitaeten]
        } else {
          for a in d.aktivitaeten {
            text(size: 8pt)[#a]
            linebreak()
          }
          if d.weitere != "" { text(size: 7pt, fill: grau)[#d.weitere] }
        }
      })
    }
  ],
  beschluesse: () => [
    #abschnitt(data.zeitraumTitel)
    #if data.beschluesse.len() == 0 [#text(fill: grau)[#data.t.gremien.keineBeschluesseImZeitraum]] else [
      #tabelle2(data.beschluesseKopf, data.beschluesse, data.beschluesseAusrichtung, data.beschluesseBreiten)
    ]
  ],
)
#for k in data.abschnitte { sektionen.at(k)() }
`;

export const PAI_ERKLAERUNG = String.raw`
#set page(flipped: true)
#beschriftung(data.kopf)
#v(0.5 * u)
#text(font: anzeige, weight: 700, size: 20pt, tracking: -0.01em)[#upper(data.titelText)]
#linebreak()
#text(size: 10pt, fill: grau)[#data.untertitel]
#v(1 * u)
#grid(columns: (1fr, 1fr, 1fr, 1fr), column-gutter: u,
  kachel(data.t.fonds, data.fonds),
  kachel(data.t.pai.berichtsjahr, data.jahr),
  kachel(data.t.pai.einordnung, data.einordnung),
  kachel(data.t.pai.katalog, data.katalog),
)
#v(0.5 * u)
#if data.entwurf [#text(size: 8pt, fill: grau)[#data.t.pai.hinweisEntwurf]]

#let sektionen = (
  vorbemerkung: () => [
    #abschnitt(data.t.pai.vorbemerkung)
    #if data.vorbemerkung.len() == 0 [#text(fill: grau)[#data.t.pai.keinText]] else [#absaetze(data.vorbemerkung)]
  ],
  tabelle: () => [
    #for g in data.gruppen [
      #abschnitt(g.titel)
      #tabelle2(data.tabellenKopf, g.zeilen, data.ausrichtung, data.breiten)
    ]
    #v(0.5 * u)
    #text(size: 7.5pt, fill: grau)[#data.t.pai.hinweisBerechnung #data.t.pai.hinweisAbdeckung]
  ],
  befunde: () => [
    #abschnitt(data.t.pai.befunde)
    #if data.befunde.len() == 0 [#text(fill: grau)[#data.t.pai.keineBefunde]] else [
      #for b in data.befunde [#text(size: 8pt)[• #b] #linebreak()]
    ]
  ],
  herkunft: () => [
    #pagebreak(weak: true)
    #abschnitt(data.t.pai.herkunft)
    #herkunftsliste(data.herkunft)
  ],
)
#for k in data.abschnitte { sektionen.at(k)() }
`;

export const MIT_GRUNDLAGE = (vorlage: string) => `${GRUNDLAGE}\n${vorlage}`;
