import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Auswahl, Button, Feld } from "@carraway/ui";
import type { Organisation, OrganisationArt } from "../api/abfragen";
import { organisationMeldedaten, useMeldedatenSetzen } from "../api/buchhaltung";
import { ApiFehler } from "../api/client";
import { useOrganisationAendern, useOrganisationAnlegen } from "../api/mutationen";
import { feldText } from "../i18n/fehler";
import { useT } from "../i18n";
import { useBereich } from "../lib/rechte";
import { Seitenpanel } from "@carraway/ui";
import { DublettenBestaetigung, DublettenHinweis, kandidatenAus } from "./Dubletten";
import { FehlerHinweis } from "./FehlerHinweis";
import { textOderNichts, textOderNull, useFormular } from "./formular";

export const ORGANISATION_ARTEN = ["unternehmen", "investor", "berater", "sonstige"] as const satisfies readonly OrganisationArt[];

const FELDER = ["name", "art", "sektor", "ort", "website"];

/** Die gemeinsamen Eingabefelder einer Organisation; `fehler` ist der Fehler der letzten Anfrage. */
export function OrganisationFelder({
  feld,
  fehler,
  onName,
}: {
  feld: ReturnType<typeof useFormular<{ name: string; art: string; sektor: string; ort: string; website: string }>>["feld"];
  fehler: unknown;
  onName?: () => void;
}) {
  const t = useT();
  const f = t.organisationForm;
  const name = feld("name");
  return (
    <>
      <Feld
        label={f.name}
        autoComplete="off"
        {...name}
        onChange={(e) => {
          name.onChange(e);
          onName?.();
        }}
        fehler={feldText(t, fehler, "name")}
      />
      <Auswahl label={f.art} {...feld("art")} fehler={feldText(t, fehler, "art")}>
        {ORGANISATION_ARTEN.map((art) => (
          <option key={art} value={art}>
            {t.organisationArt[art]}
          </option>
        ))}
      </Auswahl>
      <Feld label={f.sektor} {...feld("sektor")} fehler={feldText(t, fehler, "sektor")} />
      <Feld label={f.ort} {...feld("ort")} fehler={feldText(t, fehler, "ort")} />
      <Feld label={f.website} type="url" inputMode="url" {...feld("website")} fehler={feldText(t, fehler, "website")} />
    </>
  );
}

/** „Neue Organisation“ mit Dublettenhinweis beim Tippen und ausdrücklicher Bestätigung nach 409. */
export function OrganisationNeuDialog({ onSchliessen, namensvorschlag = "" }: { onSchliessen: () => void; namensvorschlag?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const anlegen = useOrganisationAnlegen();
  const { werte, feld } = useFormular({ name: namensvorschlag, art: "unternehmen", sektor: "", ort: "", website: "" });
  const kandidaten = kandidatenAus(anlegen.error);

  function senden(bestaetigt: boolean) {
    anlegen.mutate(
      {
        name: werte.name.trim(),
        art: werte.art as OrganisationArt,
        sektor: textOderNichts(werte.sektor),
        ort: textOderNichts(werte.ort),
        website: textOderNichts(werte.website),
        ...(bestaetigt ? { dubletteBestaetigt: true } : {}),
      },
      { onSuccess: (neu) => void navigate({ to: "/organisationen/$id", params: { id: neu.id } }) },
    );
  }

  return (
    <Seitenpanel titel={t.organisationForm.titelNeu} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{t.organisationForm.titelNeu}</h2>
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
            onVerwenden={(k) => void navigate({ to: "/organisationen/$id", params: { id: k.id } })}
          />
        ) : (
          <FehlerHinweis fehler={anlegen.error} bekannt={FELDER} />
        )}
        <OrganisationFelder feld={feld} fehler={anlegen.error} onName={() => anlegen.error instanceof ApiFehler && anlegen.reset()} />
        {kandidaten ? null : <DublettenHinweis name={werte.name} />}
        <div>
          <Button type="submit" disabled={anlegen.isPending}>
            {t.organisationForm.anlegen}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

const NACE_ABSCHNITTE = "ABCDEFGHIJKLMNOPQRSTU".split("");

export function OrganisationBearbeitenDialog({ organisation, onSchliessen }: { organisation: Organisation; onSchliessen: () => void }) {
  const t = useT();
  const aendern = useOrganisationAendern(organisation.id);
  // Sitzland und Region sind Meldedaten (Bereich Meldewesen); ohne ihn fehlen die Felder, statt eine Fehlermeldung zu zeigen.
  const mitMeldedaten = useBereich("meldewesen");
  const meldedaten = useQuery({ ...organisationMeldedaten(organisation.id), enabled: mitMeldedaten });
  const meldedatenSetzen = useMeldedatenSetzen(organisation.id);
  const [land, setLand] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const land0 = meldedaten.data?.sitzland ?? "";
  const region0 = meldedaten.data?.region ?? "";
  const landWert = land ?? land0;
  const regionWert = region ?? region0;
  const nace0 = organisation.naceAbschnitt ?? "";
  const [nace, setNace] = useState(nace0);
  const rechtsform0 = organisation.rechtsform ?? "";
  const [rechtsform, setRechtsform] = useState(rechtsform0);
  const { werte, feld } = useFormular({
    name: organisation.name,
    art: organisation.art as string,
    sektor: organisation.sektor ?? "",
    ort: organisation.ort ?? "",
    website: organisation.website ?? "",
  });

  return (
    <Seitenpanel titel={t.organisationForm.titelBearbeiten} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{t.organisationForm.titelBearbeiten}</h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault();
          // Sitzland und Region (Meldeberichte) liegen in eigenen Daten der Organisation; sie gehen nur mit, wenn sie geändert wurden.
          if (mitMeldedaten && (landWert !== land0 || regionWert !== region0)) {
            try {
              await meldedatenSetzen.mutateAsync({ sitzland: textOderNull(landWert), region: textOderNull(regionWert) });
            } catch {
              return; // der Fehler steht unter den Feldern
            }
          }
          aendern.mutate(
            {
              name: werte.name.trim(),
              art: werte.art as OrganisationArt,
              sektor: textOderNull(werte.sektor),
              ort: textOderNull(werte.ort),
              website: textOderNull(werte.website),
              // Rechtsform (Registerabgleich) und NACE-Abschnitt (ESG) gehen nur mit, wenn sie geändert wurden.
              ...(rechtsform !== rechtsform0 ? { rechtsform: textOderNull(rechtsform) } : {}),
              ...(nace !== nace0 ? { naceAbschnitt: nace === "" ? null : nace } : {}),
            },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={aendern.error ?? meldedatenSetzen.error} bekannt={[...FELDER, "rechtsform", "naceAbschnitt", "sitzland", "region"]} />
        <OrganisationFelder feld={feld} fehler={aendern.error} />
        <Feld label={t.organisationForm.rechtsform} hilfe={t.organisationForm.rechtsformHilfe} autoComplete="off" value={rechtsform} onChange={(e) => setRechtsform(e.target.value)} fehler={feldText(t, aendern.error, "rechtsform")} />
        {mitMeldedaten ? (
          <>
            <Feld
              label={t.foerderSchluessel.felder.sitzland}
              hilfe={t.foerderSchluessel.sitzlandHilfe}
              autoComplete="off"
              maxLength={2}
              disabled={meldedaten.isPending}
              value={landWert}
              onChange={(e) => setLand(e.target.value.toUpperCase())}
              fehler={feldText(t, meldedatenSetzen.error, "sitzland")}
            />
            <Feld label={t.foerderSchluessel.felder.region} autoComplete="off" disabled={meldedaten.isPending} value={regionWert} onChange={(e) => setRegion(e.target.value)} fehler={feldText(t, meldedatenSetzen.error, "region")} />
          </>
        ) : null}
        <Auswahl label={t.organisationForm.nace} hilfe={t.organisationForm.naceHilfe} value={nace} onChange={(e) => setNace(e.target.value)} fehler={feldText(t, aendern.error, "naceAbschnitt")}>
          <option value="">{t.organisationForm.naceKeine}</option>
          {NACE_ABSCHNITTE.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Auswahl>
        <div>
          <Button type="submit" disabled={aendern.isPending}>
            {t.organisationForm.speichern}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
