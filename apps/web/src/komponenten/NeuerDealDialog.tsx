import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Auswahl, Button, Feld, Segment } from "@carraway/ui";
import { fondsListe, organisationSuche, type OrganisationArt } from "../api/abfragen";
import { useRechte } from "../lib/rechte";
import { heuteIso } from "../api/datum";
import { useDealAnlegen, type NeuerDeal } from "../api/mutationen";

type NeuerDealPhase = NonNullable<NeuerDeal["phase"]>;
import { feldText } from "../i18n/fehler";
import { useT } from "../i18n";
import { Seitenpanel } from "@carraway/ui";
import type { Dealtyp } from "../lib/dealtyp";
import { DealtypAuswahl } from "./DealtypAuswahl";
import { DublettenBestaetigung, DublettenHinweis, kandidatenAus } from "./Dubletten";
import { FehlerHinweis } from "./FehlerHinweis";
import { VorschlagFeld } from "./Suchfeld";
import { betragOderNichts, textOderNichts, useEntprellt, useFormular } from "./formular";
import { ORGANISATION_ARTEN } from "./OrganisationDialoge";

type Modus = "bestehend" | "neu";

const FELDER = ["titel", "ticket", "quelle", "eingangsdatum", "herkunft", "dealtyp", "fondsId", "organisation.name", "organisation.art", "organisation.sektor", "organisation.ort", "organisationId"];

/** „Neuer Deal“: bestehende Organisation per Suche oder eine neue gleich mit, samt Dublettenprüfung. */
export function NeuerDealDialog({ onSchliessen, phase, onAngelegt, initialerDealtyp = null, titelVorschlag = "" }: {
  onSchliessen: () => void;
  phase?: NeuerDealPhase;
  /** Wird nach dem Anlegen mit dem neuen Deal gerufen; danach schließt der Dialog (ohne diese Angabe öffnet sich der Deal). */
  onAngelegt?: (neu: { id: string; titel: string; organisation: { id: string; name: string } }) => void;
  initialerDealtyp?: Dealtyp | null | undefined;
  /** Vorbefüllter Titel, z. B. die Eingabe im Suchfeld. */
  titelVorschlag?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const anlegen = useDealAnlegen();
  const { darf } = useRechte();
  const fonds = useQuery(fondsListe());
  const [modus, setModus] = useState<Modus>("bestehend");
  const [gewaehlt, setGewaehlt] = useState<{ id: string; name: string } | null>(null);
  const [suche, setSuche] = useState("");
  const [ohneAuswahl, setOhneAuswahl] = useState(false);
  const entprellt = useEntprellt(suche.trim());
  const treffer = useQuery({ ...organisationSuche(entprellt), enabled: modus === "bestehend" });
  const { werte, setWerte, feld } = useFormular({ titel: titelVorschlag, ticket: "", quelle: "", eingangsdatum: heuteIso(), herkunft: "", fondsId: "", orgName: "", orgArt: "unternehmen", orgSektor: "", orgOrt: "" });
  const [selbstUebernehmen, setSelbstUebernehmen] = useState(false);
  const [dealtyp, setDealtyp] = useState(initialerDealtyp);
  const f = t.neuerDeal;
  const kandidaten = kandidatenAus(anlegen.error);

  function senden(bestaetigt: boolean) {
    if (modus === "bestehend" && !gewaehlt) {
      setOhneAuswahl(true);
      return;
    }
    const gemeinsam: Omit<NeuerDeal, "organisationId" | "organisation"> = {
      titel: werte.titel.trim(),
      ticket: betragOderNichts(werte.ticket),
      quelle: textOderNichts(werte.quelle),
      ...(werte.eingangsdatum ? { eingangsdatum: werte.eingangsdatum } : {}),
      ...(werte.herkunft === "anfrage" || werte.herkunft === "sourcing" ? { herkunft: werte.herkunft } : {}),
      ...(dealtyp === null ? {} : { dealtyp }),
      ...(selbstUebernehmen ? { selbstUebernehmen: true } : {}),
      ...(werte.fondsId ? { fondsId: werte.fondsId } : {}),
      // Schnellanlage in einer Spalte des Boards (Startphase; ins Closing führt nur der Phasenwechsel).
      ...(phase ? { phase } : {}),
    };
    anlegen.mutate(
      modus === "bestehend" && gewaehlt
        ? { ...gemeinsam, organisationId: gewaehlt.id }
        : {
            ...gemeinsam,
            organisation: {
              name: werte.orgName.trim(),
              art: werte.orgArt as OrganisationArt,
              sektor: textOderNichts(werte.orgSektor),
              ort: textOderNichts(werte.orgOrt),
            },
            ...(bestaetigt ? { dubletteBestaetigt: true } : {}),
          },
      { onSuccess: (neu) => (onAngelegt ? (onAngelegt({ id: neu.id, titel: neu.titel, organisation: { id: neu.organisation.id, name: neu.organisation.name } }), onSchliessen()) : void navigate({ to: "/deals/$id", params: { id: neu.id } })) },
    );
  }

  const orgFehler = (name: string) => feldText(t, anlegen.error, `organisation.${name}`);
  const orgName = feld("orgName");

  return (
    <Seitenpanel titel={f.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{f.titel}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          senden(false);
        }}
      >
        {kandidaten ? (
          <DublettenBestaetigung
            kandidaten={kandidaten}
            laeuft={anlegen.isPending}
            onBestaetigen={() => senden(true)}
            onVerwenden={(k) => {
              anlegen.reset();
              setModus("bestehend");
              setGewaehlt({ id: k.id, name: k.name });
              setOhneAuswahl(false);
            }}
          />
        ) : (
          <FehlerHinweis fehler={anlegen.error} bekannt={FELDER} />
        )}
        <Feld label={f.dealTitel} {...feld("titel")} fehler={feldText(t, anlegen.error, "titel")} />

        <fieldset className="app-gruppe">
          <legend className="cw-feld__label">{f.organisation}</legend>
          <Segment<Modus>
            aria-label={f.organisation}
            value={modus}
            onChange={(neu) => {
              setModus(neu);
              anlegen.reset();
            }}
            options={[
              { wert: "bestehend", label: f.bestehend },
              { wert: "neu", label: f.neu },
            ]}
          />
          {modus === "bestehend" ? (
            <>
              <Feld
                type="search"
                label={f.organisationSuchen}
                value={suche}
                onChange={(e) => setSuche(e.target.value)}
                fehler={ohneAuswahl && !gewaehlt ? f.organisationWaehlen : feldText(t, anlegen.error, "organisationId")}
                hilfe={gewaehlt ? f.gewaehlt(gewaehlt.name) : undefined}
              />
              <ul className="app-auswahlliste" aria-label={f.treffer}>
                {(treffer.data ?? []).map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      className="app-auswahlliste__knopf"
                      aria-pressed={gewaehlt?.id === o.id}
                      onClick={() => {
                        setGewaehlt({ id: o.id, name: o.name });
                        setOhneAuswahl(false);
                      }}
                    >
                      {o.name}
                      <span className="app-dubletten__info">{[t.organisationArt[o.art], o.ort].filter(Boolean).join(" · ")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <Feld
                label={f.orgName}
                {...orgName}
                onChange={(e) => {
                  orgName.onChange(e);
                  if (kandidaten) anlegen.reset();
                }}
                fehler={orgFehler("name")}
              />
              <Auswahl label={f.orgArt} {...feld("orgArt")} fehler={orgFehler("art")}>
                {ORGANISATION_ARTEN.map((art) => (
                  <option key={art} value={art}>
                    {t.organisationArt[art]}
                  </option>
                ))}
              </Auswahl>
              <VorschlagFeld label={f.orgSektor} feld="sektor" value={werte.orgSektor} onChange={(wert) => setWerte((alt) => ({ ...alt, orgSektor: wert }))} fehler={orgFehler("sektor")} />
              <VorschlagFeld label={f.orgOrt} feld="ort" value={werte.orgOrt} onChange={(wert) => setWerte((alt) => ({ ...alt, orgOrt: wert }))} fehler={orgFehler("ort")} />
              {kandidaten ? null : <DublettenHinweis name={werte.orgName} onVerwenden={(k) => { setModus("bestehend"); setGewaehlt({ id: k.id, name: k.name }); }} />}
            </>
          )}
        </fieldset>

        <Feld label={f.ticket} zahl inputMode="decimal" hilfe={f.ticketHilfe} {...feld("ticket")} fehler={feldText(t, anlegen.error, "ticket")} />
        <Feld label={t.dealflow.eingangsdatum} type="date" {...feld("eingangsdatum")} fehler={feldText(t, anlegen.error, "eingangsdatum")} />
        <Auswahl label={t.dealflow.herkunft} {...feld("herkunft")} fehler={feldText(t, anlegen.error, "herkunft")}>
          <option value="">{t.gemeinsam.keinWert}</option>
          <option value="anfrage">{t.dealflow.herkuenfte.anfrage}</option>
          <option value="sourcing">{t.dealflow.herkuenfte.sourcing}</option>
        </Auswahl>
        <DealtypAuswahl wert={dealtyp} onWechsel={setDealtyp} fehler={feldText(t, anlegen.error, "dealtyp")} />
        <Feld label={f.quelle} {...feld("quelle")} fehler={feldText(t, anlegen.error, "quelle")} />
        <Auswahl label={f.fonds} {...feld("fondsId")} fehler={feldText(t, anlegen.error, "fondsId")}>
          <option value="">{f.keinFonds}</option>
          {fonds.data?.filter((f) => darf("bearbeiter", f.id, "dealflow")).map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Auswahl>
        <label className="app-dealflow__kontrollfeld">
          <input type="checkbox" checked={selbstUebernehmen} onChange={(e) => setSelbstUebernehmen(e.target.checked)} />
          {t.dealflow.mirZuweisen}
        </label>
        <div>
          <Button type="submit" disabled={anlegen.isPending}>
            {f.anlegen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
