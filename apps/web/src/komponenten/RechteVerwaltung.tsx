import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Feld, Hinweis, Seitenpanel, Segment, Tabelle, type TabelleSpalte } from "@carraway/ui";
import { fondsListe } from "../api/abfragen";
import {
  benutzerListe,
  rechteStand,
  useFondsOffenSetzen,
  useGruppeLoeschen,
  useGruppeSpeichern,
  useRechteRolleLoeschen,
  useRolleSpeichern,
  type RechteGruppe,
  type RechteRolle,
  type GruppeEingabe,
  type RechteStand,
  type RolleEingabe,
} from "../api/verwaltung";
import { aufzaehlung, useT } from "../i18n";
import { ROLLEN, type FondsRolle } from "../lib/rechte";
import { FehlerHinweis } from "./FehlerHinweis";

/**
 * Verwaltung → Rollen und Gruppen (Rechtemodell, docs/permissions-model.md): zentraler Fondszugriff, Rollen (Bündel von Bereichen) und
 * Nutzergruppen (Personen, Stufe, Fondszugriff, Rollen, auf Wunsch Bereiche je Fonds). Rollen begrenzen auf Wunsch die Stufe je Bereich. Die Ausnahme je Person und Fonds pflegt „Rollen je Fonds“. Die API prüft jede Anfrage selbst.
 */
export default function RechteVerwaltung() {
  const t = useT();
  const v = t.verwaltung.rechte;
  const { data, error } = useQuery(rechteStand());
  const [rolle, setRolle] = useState<RechteRolle | "neu" | null>(null);
  const [gruppe, setGruppe] = useState<RechteGruppe | "neu" | null>(null);
  if (error) return <section className="app-karte"><FehlerHinweis fehler={error} /></section>;
  if (!data) return <section className="app-karte" aria-busy="true" />;
  return (
    <>
      <FondsZugriff stand={data} />
      <Rollen stand={data} onBearbeiten={setRolle} />
      <Gruppen stand={data} onBearbeiten={setGruppe} />
      {rolle ? <RolleFormular stand={data} rolle={rolle === "neu" ? null : rolle} onSchliessen={() => setRolle(null)} /> : null}
      {gruppe ? <GruppeFormular stand={data} gruppe={gruppe === "neu" ? null : gruppe} onSchliessen={() => setGruppe(null)} /> : null}
      <p className="app-leer-text">{v.letzteGruppe}</p>
    </>
  );
}

function FondsZugriff({ stand }: { stand: RechteStand }) {
  const t = useT();
  const v = t.verwaltung.rechte;
  const setzen = useFondsOffenSetzen();
  return (
    <section className="app-karte">
      <h2 className="cw-t-untertitel app-karte__titel">{v.zugriffTitel}</h2>
      <p className="app-leer-text">{v.einleitung}</p>
      <Segment
        aria-label={v.zugriffTitel}
        value={stand.fondsOffen ? "offen" : "zugewiesen"}
        onChange={(w) => setzen.mutate(w === "offen")}
        options={[
          { wert: "offen", label: v.zugriff.offen },
          { wert: "zugewiesen", label: v.zugriff.zugewiesen },
        ]}
      />
      <p className="app-leer-text">{v.zugriffHilfe}</p>
      <FehlerHinweis fehler={setzen.error} />
    </section>
  );
}

type Uebersetzung = ReturnType<typeof useT>;

const bereichsNamen = (v: Uebersetzung["verwaltung"]["rechte"], bereiche: readonly string[], keine: string) =>
  bereiche.length ? bereiche.map((b) => aufzaehlung(v.bereiche, b)).join(", ") : keine;

/** Bereiche einer Rolle mit ihrer Grenze, z. B. „Finanzen (höchstens Betrachter)“. */
const bereicheMitGrenze = (t: Uebersetzung, r: RechteRolle) => {
  const v = t.verwaltung.rechte;
  if (!r.bereiche.length) return v.keine;
  const grenzen = (r.bereichStufen ?? {}) as Partial<Record<string, FondsRolle>>;
  return r.bereiche
    .map((b) => {
      const grenze = grenzen[b];
      return grenze ? v.mitGrenze(aufzaehlung(v.bereiche, b), aufzaehlung(t.rolle, grenze)) : aufzaehlung(v.bereiche, b);
    })
    .join(", ");
};

function Rollen({ stand, onBearbeiten }: { stand: RechteStand; onBearbeiten: (r: RechteRolle | "neu") => void }) {
  const t = useT();
  const v = t.verwaltung.rechte;
  const loeschen = useRechteRolleLoeschen();
  const spalten: TabelleSpalte<RechteRolle>[] = [
    { schluessel: "name", kopf: v.spalten.name, zelle: (r) => r.name },
    { schluessel: "bereiche", kopf: v.spalten.bereiche, zelle: (r) => bereicheMitGrenze(t, r) },
  ];
  return (
    <section className="app-karte">
      <div className="app-aktionen">
        <h2 className="cw-t-untertitel app-karte__titel">{v.rollenTitel}</h2>
        <Button variante="sekundaer" onClick={() => onBearbeiten("neu")}>
          {v.rolleAnlegen}
        </Button>
      </div>
      <FehlerHinweis fehler={loeschen.error} />
      <Tabelle
        beschriftung={v.rollenTitel}
        spalten={spalten}
        zeilen={stand.rollen}
        zeilenSchluessel={(r) => r.id}
        dicht
        leer={<p className="app-leer-text">{v.keineRollen}</p>}
        aktionen={(r) => [
          { id: "bearbeiten", label: v.bearbeiten, onClick: () => onBearbeiten(r) },
          { id: "loeschen", label: v.loeschen, gefahr: true, onClick: () => { if (window.confirm(v.loeschenFrage(r.name))) loeschen.mutate(r.id); } },
        ]}
      />
    </section>
  );
}

function Gruppen({ stand, onBearbeiten }: { stand: RechteStand; onBearbeiten: (g: RechteGruppe | "neu") => void }) {
  const t = useT();
  const v = t.verwaltung.rechte;
  const { data: fonds } = useQuery(fondsListe());
  const loeschen = useGruppeLoeschen();
  const fondsName = (id: string) => fonds?.find((f) => f.id === id)?.kurzname ?? "…";
  const rollenName = (id: string) => stand.rollen.find((r) => r.id === id)?.name ?? "…";
  const spalten: TabelleSpalte<RechteGruppe>[] = [
    { schluessel: "name", kopf: v.spalten.name, zelle: (g) => g.name },
    { schluessel: "stufe", kopf: v.spalten.stufe, zelle: (g) => aufzaehlung(t.rolle, g.stufe) },
    {
      schluessel: "fonds",
      kopf: v.spalten.fonds,
      zelle: (g) => {
        const auswahl = (g.fondsBereiche ?? {}) as Partial<Record<string, string[]>>;
        const genannt = g.fondsIds.map((f) => {
          const bereiche = g.bereicheJeFonds ? auswahl[f] : undefined;
          return bereiche ? v.spalteFondsBereiche(fondsName(f), bereichsNamen(v, bereiche, v.keine)) : fondsName(f);
        });
        if (!g.fondsBeschraenkt && stand.fondsOffen) return genannt.length && g.bereicheJeFonds ? `${v.alleFonds}; ${genannt.join("; ")}` : v.alleFonds;
        return genannt.length ? genannt.join(g.bereicheJeFonds ? "; " : ", ") : v.keineFonds;
      },
    },
    { schluessel: "rollen", kopf: v.spalten.rollen, zelle: (g) => (g.rollenIds.length ? g.rollenIds.map(rollenName).join(", ") : v.keine) },
    { schluessel: "mitglieder", kopf: v.spalten.mitglieder, zahl: true, zelle: (g) => g.mitglieder.length },
  ];
  return (
    <section className="app-karte">
      <div className="app-aktionen">
        <h2 className="cw-t-untertitel app-karte__titel">{v.gruppenTitel}</h2>
        <Button variante="sekundaer" onClick={() => onBearbeiten("neu")}>
          {v.gruppeAnlegen}
        </Button>
      </div>
      <FehlerHinweis fehler={loeschen.error} />
      <Tabelle
        beschriftung={v.gruppenTitel}
        spalten={spalten}
        zeilen={stand.gruppen}
        zeilenSchluessel={(g) => g.id}
        dicht
        leer={<p className="app-leer-text">{v.keineGruppen}</p>}
        aktionen={(g) => [
          { id: "bearbeiten", label: v.bearbeiten, onClick: () => onBearbeiten(g) },
          { id: "loeschen", label: v.loeschen, gefahr: true, onClick: () => { if (window.confirm(v.loeschenFrage(g.name))) loeschen.mutate(g.id); } },
        ]}
      />
    </section>
  );
}

/** Mehrfachauswahl als Haken in einem Formularraster. */
function Haken({ legende, optionen, gewaehlt, onChange }: { legende: string; optionen: { id: string; label: string }[]; gewaehlt: string[]; onChange: (ids: string[]) => void }) {
  return (
    <fieldset className="app-gruppe">
      <legend className="cw-feld__label">{legende}</legend>
      <div className="cw-formularraster">
        {optionen.map((o) => (
          <label key={o.id} className="app-haken">
            <input type="checkbox" checked={gewaehlt.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...gewaehlt, o.id] : gewaehlt.filter((x) => x !== o.id))} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RolleFormular({ stand, rolle, onSchliessen }: { stand: RechteStand; rolle: RechteRolle | null; onSchliessen: () => void }) {
  const t = useT();
  const v = t.verwaltung.rechte;
  const speichern = useRolleSpeichern();
  const [name, setName] = useState(rolle?.name ?? "");
  const [beschreibung, setBeschreibung] = useState(rolle?.beschreibung ?? "");
  const [bereiche, setBereiche] = useState<string[]>(rolle?.bereiche ?? []);
  const [grenzen, setGrenzen] = useState<Partial<Record<string, FondsRolle>>>((rolle?.bereichStufen as Partial<Record<string, FondsRolle>> | undefined) ?? {});
  const titel = rolle ? rolle.name : v.rolleNeu;
  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          // Grenzen nur für gewählte Bereiche; die API verwirft andere ohnehin.
          const bereichStufen = Object.fromEntries(bereiche.flatMap((b) => (grenzen[b] ? [[b, grenzen[b]]] : []))) as RolleEingabe["bereichStufen"];
          const werte = { name: name.trim(), beschreibung: beschreibung.trim() || null, bereiche: bereiche as RolleEingabe["bereiche"], bereichStufen };
          speichern.mutate({ ...(rolle ? { id: rolle.id } : {}), werte }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={speichern.error} bekannt={["name", "description", "areas", "areaLevels"]} />
        <div className="cw-formularraster">
          <Feld label={v.name} value={name} required onChange={(e) => setName(e.target.value)} />
          <Feld label={v.beschreibung} value={beschreibung} breit onChange={(e) => setBeschreibung(e.target.value)} />
        </div>
        <Haken legende={v.bereicheLegende} optionen={stand.bereiche.map((b) => ({ id: b, label: aufzaehlung(v.bereiche, b) }))} gewaehlt={bereiche} onChange={setBereiche} />
        {bereiche.length ? (
          <fieldset className="app-gruppe">
            <legend className="cw-feld__label">{v.grenze}</legend>
            <p className="app-leer-text">{v.grenzeHilfe}</p>
            <div className="cw-formularraster">
              {stand.bereiche
                .filter((b) => bereiche.includes(b))
                .map((b) => (
                  <Auswahl key={b} kompakt label={aufzaehlung(v.bereiche, b)} aria-label={`${v.grenze}: ${aufzaehlung(v.bereiche, b)}`} value={grenzen[b] ?? ""} onChange={(e) => setGrenzen({ ...grenzen, [b]: (e.target.value || undefined) as FondsRolle | undefined })}>
                    <option value="">{v.ohneGrenze}</option>
                    {ROLLEN.map((r) => (
                      <option key={r} value={r}>
                        {aufzaehlung(t.rolle, r)}
                      </option>
                    ))}
                  </Auswahl>
                ))}
            </div>
          </fieldset>
        ) : null}
        <div className="app-aktionen__knoepfe">
          <Button type="submit" disabled={speichern.isPending || !name.trim()}>
            {v.speichern}
          </Button>
          <Button variante="ruhig" onClick={onSchliessen}>
            {v.abbrechen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

function GruppeFormular({ stand, gruppe, onSchliessen }: { stand: RechteStand; gruppe: RechteGruppe | null; onSchliessen: () => void }) {
  const t = useT();
  const v = t.verwaltung.rechte;
  const { data: fonds } = useQuery(fondsListe());
  const { data: personen } = useQuery(benutzerListe());
  const speichern = useGruppeSpeichern();
  const [name, setName] = useState(gruppe?.name ?? "");
  const [beschreibung, setBeschreibung] = useState(gruppe?.beschreibung ?? "");
  const [stufe, setStufe] = useState<FondsRolle>(gruppe?.stufe ?? "betrachter");
  const [beschraenkt, setBeschraenkt] = useState(gruppe?.fondsBeschraenkt ?? !stand.fondsOffen);
  const [fondsIds, setFondsIds] = useState<string[]>(gruppe?.fondsIds ?? []);
  const [jeFonds, setJeFonds] = useState(gruppe?.bereicheJeFonds ?? false);
  const [fondsBereiche, setFondsBereiche] = useState<Partial<Record<string, string[]>>>((gruppe?.fondsBereiche as Partial<Record<string, string[]>> | undefined) ?? {});
  const [rollenIds, setRollenIds] = useState<string[]>(gruppe?.rollenIds ?? []);
  const [mitglieder, setMitglieder] = useState<string[]>(gruppe?.mitglieder ?? []);
  const titel = gruppe ? gruppe.name : v.gruppeNeu;
  // Investor-Benutzer stehen nicht in der Benutzerliste; technische Benutzer (API-Schlüssel) gehören zu keiner Gruppe.
  const waehlbar = (personen ?? []).filter((p) => !p.technisch && !p.globalVerwalter);
  // Je Fonds wählbar sind die Bereiche der gewählten Rollen, in der festen Reihenfolge der Bereiche.
  const rollenBereiche = stand.bereiche.filter((b) => stand.rollen.some((r) => rollenIds.includes(r.id) && r.bereiche.includes(b)));
  return (
    <Seitenpanel titel={titel} onSchliessen={onSchliessen} breit>
      <h2 className="cw-t-untertitel">{titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          // Auswahl je Fonds nur mit dem Schalter und nur für gewählte Fonds; ohne Auswahl gelten alle Bereiche der Rollen.
          const auswahl = jeFonds ? Object.fromEntries(fondsIds.flatMap((f) => (fondsBereiche[f]?.length ? [[f, fondsBereiche[f]]] : []))) : {};
          const werte = { name: name.trim(), beschreibung: beschreibung.trim() || null, stufe, fondsBeschraenkt: beschraenkt, bereicheJeFonds: jeFonds, fondsIds, fondsBereiche: auswahl as GruppeEingabe["fondsBereiche"], rollenIds, mitglieder };
          speichern.mutate({ ...(gruppe ? { id: gruppe.id } : {}), werte }, { onSuccess: onSchliessen });
        }}
      >
        <FehlerHinweis fehler={speichern.error} bekannt={["name", "description", "level", "fundIds", "fundAreas", "roleIds", "memberIds"]} />
        <div className="cw-formularraster">
          <Feld label={v.name} value={name} required onChange={(e) => setName(e.target.value)} />
          <Auswahl label={v.stufe} hilfe={v.stufeHilfe} value={stufe} onChange={(e) => setStufe(e.target.value as FondsRolle)}>
            {ROLLEN.map((r) => (
              <option key={r} value={r}>
                {aufzaehlung(t.rolle, r)}
              </option>
            ))}
          </Auswahl>
          <Feld label={v.beschreibung} value={beschreibung} breit onChange={(e) => setBeschreibung(e.target.value)} />
        </div>
        <Haken legende={v.rollenLegende} optionen={stand.rollen.map((r) => ({ id: r.id, label: r.name }))} gewaehlt={rollenIds} onChange={setRollenIds} />
        <label className="app-schalter">
          <input type="checkbox" checked={beschraenkt} onChange={(e) => setBeschraenkt(e.target.checked)} />
          <span>{v.fondsBeschraenkt}</span>
        </label>
        {!beschraenkt && stand.fondsOffen ? (
          <Hinweis>{v.alleFonds}</Hinweis>
        ) : (
          <Haken legende={v.fondsLegende} optionen={(fonds ?? []).map((f) => ({ id: f.id, label: f.name }))} gewaehlt={fondsIds} onChange={setFondsIds} />
        )}
        <label className="app-schalter">
          <input type="checkbox" checked={jeFonds} onChange={(e) => setJeFonds(e.target.checked)} />
          <span>{v.bereicheJeFonds}</span>
        </label>
        <p className="app-leer-text">{v.bereicheJeFondsHilfe}</p>
        {jeFonds ? (
          !beschraenkt && stand.fondsOffen ? (
            <p className="app-leer-text">{v.nurAusgewaehlteFonds}</p>
          ) : (
            <>
              {fondsIds.length ? <p className="app-leer-text">{v.alleBereicheDerRollen}</p> : null}
              {fondsIds.map((f) => (
                <Haken
                  key={f}
                  legende={v.bereicheJeFondsLegende(fonds?.find((x) => x.id === f)?.name ?? "…")}
                  optionen={rollenBereiche.map((b) => ({ id: b, label: aufzaehlung(v.bereiche, b) }))}
                  gewaehlt={fondsBereiche[f] ?? []}
                  onChange={(ids) => setFondsBereiche({ ...fondsBereiche, [f]: ids })}
                />
              ))}
            </>
          )
        ) : null}
        <Haken legende={v.mitgliederLegende} optionen={waehlbar.map((p) => ({ id: p.id, label: p.name }))} gewaehlt={mitglieder} onChange={setMitglieder} />
        <div className="app-aktionen__knoepfe">
          <Button type="submit" disabled={speichern.isPending || !name.trim()}>
            {v.speichern}
          </Button>
          <Button variante="ruhig" onClick={onSchliessen}>
            {v.abbrechen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
