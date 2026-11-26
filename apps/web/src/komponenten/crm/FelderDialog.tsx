import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld as Eingabe, PlusIcon, Seitenpanel, TrashIcon } from "@carraway/ui";
import { zusatzDefinitionen, alsCrmFeld, PORTFOLIO_OBJEKTE, type PortfolioObjekt } from "../../api/zusatzfelder";
import { crmFelder, useFeldAendern, useFeldAnlegen, useFeldArchivieren, type Feld, type FeldTyp, type Objekt, type Option } from "../../api/crm";
import { FehlerHinweis } from "../FehlerHinweis";
import { WaehrungAuswahl } from "../WaehrungAuswahl";
import { useT } from "../../i18n";
import { FARBEN } from "./typen";

const TYPEN: FeldTyp[] = ["text", "langtext", "zahl", "betrag", "datum", "auswahl", "mehrfachauswahl", "kontrollkaestchen", "url", "email", "telefon", "benutzer", "verknuepfung"];

/** Schlüssel einer Option aus ihrer Bezeichnung (Kleinbuchstaben, Ziffern, Unterstrich). */
export function optionsSchluessel(label: string): string {
  const roh = label
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return roh.slice(0, 40) || "option";
}

interface Entwurf {
  id: string | null;
  name: string;
  typ: FeldTyp;
  optionen: Option[];
  ziel: Objekt;
  /** Währung eines Betragsfeldes; nach dem Anlegen fest (die gespeicherten Beträge gelten in dieser Währung). */
  waehrung: string;
}

const leer = (): Entwurf => ({ id: null, name: "", typ: "text", optionen: [{ schluessel: "", label: "", farbe: "grau" }], ziel: "organisation", waehrung: "EUR" });

/**
 * Eigene Felder eines Objekts verwalten (globale Verwalter, bei Listen auch deren Besitzer): anlegen, umbenennen, Optionen ergänzen,
 * archivieren und wiederherstellen. Der Typ ist nach dem Anlegen fest; Archivieren behält die Werte.
 */
export function FelderDialog({ objekt, listeId, onSchliessen }: { objekt: Objekt | PortfolioObjekt; listeId?: string; onSchliessen: () => void }) {
  const t = useT();
  const portfolio = PORTFOLIO_OBJEKTE.includes(objekt as PortfolioObjekt);
  const crm = useQuery({ ...crmFelder(portfolio ? "organisation" : (objekt as Objekt), listeId, true), enabled: !portfolio });
  const definitionen = useQuery({ ...zusatzDefinitionen(objekt as PortfolioObjekt, true), enabled: portfolio });
  // Felder der Portfolio-Objekte kommen als Definitionen (Etappe 21) und erscheinen hier wie die eigenen Felder der CRM-Objekte.
  const felder = portfolio ? { data: (definitionen.data ?? []).map((d) => ({ ...alsCrmFeld(d, true), archiviertAm: d.archiviertAm })), isPending: definitionen.isPending } : crm;
  const anlegen = useFeldAnlegen();
  const aendern = useFeldAendern();
  const archivieren = useFeldArchivieren();
  const [entwurf, setEntwurf] = useState<Entwurf | null>(null);
  const eigene = (felder.data ?? []).filter((f) => !f.system && (listeId ? f.listeId === listeId : !f.listeId));
  const fehler = anlegen.error ?? aendern.error ?? archivieren.error;

  function bearbeite(f: Feld) {
    setEntwurf({ id: f.definitionId ?? null, name: f.name, typ: f.typ, optionen: f.optionen.optionen ?? [], ziel: f.optionen.ziel ?? "organisation", waehrung: typeof f.optionen.waehrung === "string" ? f.optionen.waehrung : "EUR" });
  }

  function senden(e: FormEvent) {
    e.preventDefault();
    if (!entwurf || !entwurf.name.trim()) return;
    const mitOptionen = entwurf.typ === "auswahl" || entwurf.typ === "mehrfachauswahl";
    const optionen: Record<string, unknown> | undefined = mitOptionen
      ? { optionen: entwurf.optionen.filter((o) => o.label.trim()).map((o) => ({ schluessel: o.schluessel || optionsSchluessel(o.label), label: o.label.trim(), farbe: o.farbe })) }
      : entwurf.typ === "verknuepfung"
        ? { ziel: entwurf.ziel }
        : entwurf.typ === "betrag"
          ? { waehrung: entwurf.waehrung }
          : undefined;
    const fertig = { onSuccess: () => setEntwurf(null) };
    if (entwurf.id) aendern.mutate({ id: entwurf.id, name: entwurf.name.trim(), ...(optionen && entwurf.typ !== "verknuepfung" && entwurf.typ !== "betrag" ? { optionen } : {}) }, fertig);
    else anlegen.mutate({ objekt, ...(listeId ? { listeId } : {}), name: entwurf.name.trim(), typ: entwurf.typ, ...(optionen ? { optionen } : {}) }, fertig);
  }

  const setzeOption = (i: number, teil: Partial<Option>) => setEntwurf((alt) => (alt ? { ...alt, optionen: alt.optionen.map((o, j) => (j === i ? { ...o, ...teil } : o)) } : alt));

  return (
    <Seitenpanel titel={t.crm.felderTitel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{listeId ? t.crm.listenfelderTitel : t.crm.felderTitel}</h2>
      <p className="app-leer-text">{t.crm.felderHinweis}</p>
      <FehlerHinweis fehler={fehler} />
      {felder.isPending ? <p>{t.gemeinsam.laedt}</p> : null}
      {eigene.length === 0 && !felder.isPending ? <p className="app-leer-text">{t.crm.keineFelder}</p> : null}
      <ul className="app-felderliste">
        {eigene.map((f) => (
          <li key={f.schluessel} data-archiviert={f.archiviertAm ? true : undefined}>
            <span className="app-felderliste__name">{f.name}</span>
            <span className="app-dubletten__info">
              {(t.crm.feldtypen as Record<string, string>)[f.typ]}
              {f.archiviertAm ? ` · ${t.crm.archiviert}` : ""}
            </span>
            <span className="app-felderliste__knoepfe">
              {!f.archiviertAm ? (
                <Button variante="sekundaer" aria-label={t.crm.feldBearbeiten(f.name)} onClick={() => bearbeite(f)}>
                  {t.gemeinsam.bearbeiten}
                </Button>
              ) : null}
              <Button variante="ruhig" aria-label={f.archiviertAm ? t.crm.feldWiederherstellen(f.name) : t.crm.feldArchivieren(f.name)} onClick={() => archivieren.mutate({ id: f.definitionId!, wiederherstellen: Boolean(f.archiviertAm) })}>
                {f.archiviertAm ? t.crm.wiederherstellen : t.crm.archivieren}
              </Button>
            </span>
          </li>
        ))}
      </ul>

      {entwurf ? (
        <form className="app-formular app-feldformular" onSubmit={senden} noValidate aria-label={entwurf.id ? t.crm.feldBearbeitenTitel : t.crm.feldNeuTitel}>
          <Eingabe label={t.crm.feldName} value={entwurf.name} onChange={(e) => setEntwurf({ ...entwurf, name: e.target.value })} />
          <Auswahl label={t.crm.feldTyp} value={entwurf.typ} disabled={entwurf.id !== null} hilfe={entwurf.id ? t.crm.feldTypFest : undefined} onChange={(e) => setEntwurf({ ...entwurf, typ: e.target.value as FeldTyp })}>
            {TYPEN.map((x) => (
              <option key={x} value={x}>
                {(t.crm.feldtypen as Record<string, string>)[x]}
              </option>
            ))}
          </Auswahl>
          {entwurf.typ === "verknuepfung" ? (
            <Auswahl label={t.crm.feldZiel} value={entwurf.ziel} disabled={entwurf.id !== null} onChange={(e) => setEntwurf({ ...entwurf, ziel: e.target.value as Objekt })}>
              <option value="organisation">{t.crm.objekte.organisation}</option>
              <option value="person">{t.crm.objekte.person}</option>
              <option value="deal">{t.crm.objekte.deal}</option>
            </Auswahl>
          ) : null}
          {entwurf.typ === "betrag" ? <WaehrungAuswahl label={t.crm.feldWaehrung} value={entwurf.waehrung} disabled={entwurf.id !== null} onChange={(e) => setEntwurf({ ...entwurf, waehrung: e.target.value })} /> : null}
          {entwurf.typ === "auswahl" || entwurf.typ === "mehrfachauswahl" ? (
            <fieldset className="app-gruppe">
              <legend className="cw-t-beschriftung">{t.crm.feldOptionen}</legend>
              {entwurf.optionen.map((o, i) => (
                <div key={i} className="app-optionszeile">
                  <Eingabe label={t.crm.optionLabel(i + 1)} value={o.label} onChange={(e) => setzeOption(i, { label: e.target.value })} />
                  <Auswahl label={t.crm.optionFarbe(i + 1)} value={o.farbe} onChange={(e) => setzeOption(i, { farbe: e.target.value as Option["farbe"] })}>
                    {FARBEN.map((fa) => (
                      <option key={fa} value={fa}>
                        {(t.crm.farben as Record<string, string>)[fa]}
                      </option>
                    ))}
                  </Auswahl>
                  <Button
                    variante="ruhig"
                    icon={<TrashIcon />}
                    aria-label={t.crm.optionEntfernen(i + 1)}
                    disabled={entwurf.optionen.length === 1}
                    onClick={() => setEntwurf({ ...entwurf, optionen: entwurf.optionen.filter((_, j) => j !== i) })}
                  />
                </div>
              ))}
              <Button variante="sekundaer" icon={<PlusIcon />} onClick={() => setEntwurf({ ...entwurf, optionen: [...entwurf.optionen, { schluessel: "", label: "", farbe: FARBEN[entwurf.optionen.length % FARBEN.length]! }] })}>
                {t.crm.optionHinzufuegen}
              </Button>
            </fieldset>
          ) : null}
          <div className="app-fed__fuss">
            <Button type="submit" disabled={anlegen.isPending || aendern.isPending}>
              {t.crm.speichern}
            </Button>
            <Button variante="sekundaer" onClick={() => setEntwurf(null)}>
              {t.crm.abbrechen}
            </Button>
          </div>
        </form>
      ) : (
        <Button variante="sekundaer" icon={<PlusIcon />} onClick={() => setEntwurf(leer())}>
          {t.crm.feldNeu}
        </Button>
      )}
    </Seitenpanel>
  );
}
