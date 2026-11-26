import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Auswahl, Button, ButtonLink, Hinweis, Seitenkopf, Status, Tabelle, type StatusVariante, type TabelleSpalte } from "@carraway/ui";
import { useKontaktimport, useKontaktimportVorschau } from "../api/mutationen";
import { ApiFehler } from "../api/client";
import { DateiDropzone } from "../komponenten/DateiDropzone";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { NurLesen } from "../komponenten/NurLesen";
import { aufzaehlung, useT } from "../i18n";
import { importVorlageUrl } from "../lib/berichteUrl";
import { useRechte } from "../lib/rechte";

type Format = "csv" | "xlsx";
type Aktion = "anlegen" | "zusammenfuehren" | "ueberspringen";

/** Eine Zeile der Vorschau, soweit die Oberfläche sie braucht. Welche Zeile neu, vorhanden oder fehlerhaft ist, entscheidet die API. */
interface Zeile {
  zeile: number;
  typ: "organisation" | "person" | null;
  anzeige: string;
  fehler: string[];
  status: "neu" | "vorhanden" | "fehler";
  vorhanden: { id: string | null; name: string; zeileInDatei: number | null } | null;
  kandidaten: { id: string; name?: string; vorname?: string; nachname?: string }[];
  organisation: { name: string } | null;
  vorschlag: Aktion;
  ergebnis: string | null;
}

const STATUS: Record<string, StatusVariante> = { neu: "freigegeben", vorhanden: "pruefung", fehler: "fehlt" };

function alsBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

const kandidatName = (k: Zeile["kandidaten"][number]) => k.name ?? `${k.vorname ?? ""} ${k.nachname ?? ""}`.trim();

/** Kontaktimport: Vorlage laden, Datei prüfen (Vorschau mit ähnlichen Datensätzen je Zeile), Entscheidungen treffen, übernehmen. */
export function KontaktImportSeite() {
  const t = useT();
  const k = t.kontaktimport;
  const { darf } = useRechte();
  const vorschau = useKontaktimportVorschau();
  const uebernehmen = useKontaktimport();
  const [dateiname, setDateiname] = useState("");
  const [datei, setDatei] = useState<{ format: Format; inhalt: string } | null>(null);
  const [formatFehler, setFormatFehler] = useState(false);
  const [wahl, setWahl] = useState<Record<number, string>>({});

  const daten = vorschau.data as { unbekannteSpalten: string[]; zusammenfassung: { zeilen: number; neu: number; vorhanden: number; mitKandidaten: number; fehler: number }; zeilen: Zeile[] } | undefined;
  const ergebnis = uebernehmen.data as { zusammenfassung: { angelegt: number; ergaenzt: number; unveraendert: number; uebersprungen: number; fehler: number }; zeilen: Zeile[] } | undefined;
  const schreiben = darf("bearbeiter");

  async function waehleDatei(f: File | undefined) {
    uebernehmen.reset();
    vorschau.reset();
    setWahl({});
    setFormatFehler(false);
    setDateiname(f?.name ?? "");
    if (!f) return setDatei(null);
    const endung = f.name.toLowerCase().split(".").pop();
    if (endung !== "csv" && endung !== "xlsx") {
      setDatei(null);
      return setFormatFehler(true);
    }
    const neu = { format: endung as Format, inhalt: alsBase64(new Uint8Array(await f.arrayBuffer())) };
    setDatei(neu);
  }

  const aktuell = (z: Zeile): string => wahl[z.zeile] ?? (z.vorschlag === "zusammenfuehren" ? "zusammenfuehren" : z.vorschlag);
  /** Entscheidungen im Format der API; was dem Vorschlag entspricht, braucht keine. */
  function entscheidungen() {
    return (daten?.zeilen ?? []).flatMap((z) => {
      const w = wahl[z.zeile];
      if (!w || z.status === "fehler") return [];
      if (w.startsWith("zusammenfuehren:")) return [{ zeile: z.zeile, aktion: "zusammenfuehren" as const, zielId: w.slice("zusammenfuehren:".length) }];
      return [{ zeile: z.zeile, aktion: w as Aktion }];
    });
  }

  const grundText = (code: string) => aufzaehlung(k.fehlerGrund, code);
  const spalten: TabelleSpalte<Zeile>[] = [
    { schluessel: "zeile", kopf: k.spalten.zeile, zahl: true, zelle: (z) => z.zeile },
    { schluessel: "typ", kopf: k.spalten.typ, zelle: (z) => (z.typ ? aufzaehlung(k.typ, z.typ) : t.gemeinsam.keinWert) },
    {
      schluessel: "name",
      kopf: k.spalten.name,
      zelle: (z) => (
        <>
          {z.anzeige || t.gemeinsam.keinWert}
          {z.organisation ? <span className="app-dubletten__info"> · {k.organisationAus(z.organisation.name)}</span> : null}
        </>
      ),
    },
    {
      schluessel: "status",
      kopf: k.spalten.status,
      umbruch: true,
      zelle: (z) => (
        <>
          <Status variante={STATUS[z.status] ?? "entwurf"}>{aufzaehlung(k.status, z.status)}</Status>
          {z.fehler.length > 0 ? <span className="app-dubletten__info"> {z.fehler.map(grundText).join("; ")}</span> : null}
          {z.vorhanden ? (
            <span className="app-dubletten__info"> {z.vorhanden.id ? z.vorhanden.name : k.vorhandenInDatei(z.vorhanden.zeileInDatei ?? 0)}</span>
          ) : null}
        </>
      ),
    },
    {
      schluessel: "aktion",
      kopf: k.spalten.aktion,
      zelle: (z) =>
        z.status === "fehler" ? (
          t.gemeinsam.keinWert
        ) : (
          <Auswahl label={<span className="cw-nur-lesen">{k.aktionName(z.zeile)}</span>} value={aktuell(z)} onChange={(e) => setWahl((alt) => ({ ...alt, [z.zeile]: e.target.value }))} className="app-auswahl--klein">
            <option value="anlegen">{k.aktionen.anlegen}</option>
            {z.vorhanden ? <option value="zusammenfuehren">{k.aktionen.zusammenfuehren}</option> : null}
            {z.kandidaten.map((c) => (
              <option key={c.id} value={`zusammenfuehren:${c.id}`}>
                {k.zusammenfuehrenMit(kandidatName(c))}
              </option>
            ))}
            <option value="ueberspringen">{k.aktionen.ueberspringen}</option>
          </Auswahl>
        ),
    },
  ];

  const unguelt = vorschau.error instanceof ApiFehler && vorschau.error.code === "IMPORT_UNGUELTIG" ? vorschau.error : null;

  return (
    <div className="app-seite">
      <Seitenkopf
        meta={k.etikett}
        titel={k.titel}
        aktionen={
          <Link to="/kontakte" className="cw-button cw-button--sekundaer">
            {k.zuKontakten}
          </Link>
        }
      />
      <NurLesen />
      <section className="app-karte" aria-label={k.vorlage}>
        <p className="app-leer-text">{k.einleitung}</p>
        <h2 className="cw-t-untertitel app-karte__titel">{k.vorlage}</h2>
        <p className="app-leer-text">{k.vorlageHinweis}</p>
        <div className="app-knoepfe">
          {(["de", "en"] as const).flatMap((s) =>
            (["csv", "xlsx"] as const).map((f) => (
              <ButtonLink key={`${s}${f}`} variante="sekundaer" href={importVorlageUrl(s, f)} download aria-label={k.vorlageLink(f.toUpperCase(), s.toUpperCase())}>
                {`${f.toUpperCase()} ${s.toUpperCase()}`}
              </ButtonLink>
            )),
          )}
        </div>
      </section>

      {schreiben ? (
        <section className="app-karte">
          <form
            className="app-aktionen"
            onSubmit={(e) => {
              e.preventDefault();
              if (datei) vorschau.mutate(datei);
            }}
          >
            <DateiDropzone
              id="import-datei"
              label={k.datei}
              accept=".csv,.xlsx"
              dateiname={dateiname}
              deaktiviert={vorschau.isPending || uebernehmen.isPending}
              onDateien={([datei]) => void waehleDatei(datei)}
            />
            <Button type="submit" disabled={!datei || vorschau.isPending}>
              {k.pruefen}
            </Button>
          </form>
          {formatFehler ? <Hinweis variante="fehler">{k.nurFormat}</Hinweis> : null}
        </section>
      ) : null}

      {unguelt ? <Hinweis variante="fehler">{aufzaehlung(k.ungueltig, String(unguelt.zusatz.grund))}</Hinweis> : <FehlerHinweis fehler={vorschau.error ?? uebernehmen.error} />}

      {daten && !ergebnis ? (
        <section className="app-karte" aria-busy={uebernehmen.isPending}>
          <h2 className="cw-t-untertitel app-karte__titel">{k.vorschau}</h2>
          <p role="status">{k.zusammenfassung(daten.zusammenfassung.zeilen, daten.zusammenfassung.neu, daten.zusammenfassung.vorhanden, daten.zusammenfassung.mitKandidaten, daten.zusammenfassung.fehler)}</p>
          {daten.unbekannteSpalten.length > 0 ? <Hinweis>{k.unbekannteSpalten(daten.unbekannteSpalten.join(", "))}</Hinweis> : null}
          <Tabelle beschriftung={k.vorschau} spalten={spalten} zeilen={daten.zeilen} zeilenSchluessel={(z) => z.zeile} />
          <Hinweis>{k.uebernehmenHinweis}</Hinweis>
          <div>
            <Button disabled={uebernehmen.isPending || !datei} onClick={() => datei && uebernehmen.mutate({ ...datei, entscheidungen: entscheidungen() })}>
              {k.uebernehmen}
            </Button>
          </div>
        </section>
      ) : null}

      {ergebnis ? (
        <section className="app-karte" aria-label={k.ergebnisTitel}>
          <h2 className="cw-t-untertitel app-karte__titel">{k.ergebnisTitel}</h2>
          <p role="status">
            {k.ergebnis(
              ergebnis.zusammenfassung.angelegt,
              ergebnis.zusammenfassung.ergaenzt,
              ergebnis.zusammenfassung.unveraendert,
              ergebnis.zusammenfassung.uebersprungen,
              ergebnis.zusammenfassung.fehler,
            )}
          </p>
          <ul className="app-liste-klein">
            {ergebnis.zeilen.map((z) => (
              <li key={z.zeile}>
                {k.spalten.zeile} {z.zeile}: {z.anzeige || t.gemeinsam.keinWert}, {z.ergebnis ? aufzaehlung(k.ergebnisZeile, z.ergebnis) : t.gemeinsam.keinWert}
                {z.fehler.length > 0 ? ` (${z.fehler.map(grundText).join("; ")})` : ""}
              </li>
            ))}
          </ul>
          <div>
            <Button
              variante="sekundaer"
              onClick={() => {
                uebernehmen.reset();
                vorschau.reset();
                setDatei(null);
                setWahl({});
                setDateiname("");
              }}
            >
              {k.neueDatei}
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
