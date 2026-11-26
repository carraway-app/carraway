import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Hinweis } from "@carraway/ui";
import { organisationDetail } from "../api/abfragen";
import { useAbfragePerMail } from "../api/mail";
import type { Link as AbfrageLink } from "../api/kennzahlen";
import { useT } from "../i18n";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "./FehlerHinweis";

/** Kontakte des Unternehmens mit Mailadresse (Empfänger des Links); zusammengeführte Personen liefert die API nicht. */
function useKontakteMitMail(organisationId: string) {
  const abfrage = useQuery(organisationDetail(organisationId));
  return { ...abfrage, kontakte: (abfrage.data?.personen ?? []).filter((p) => Boolean(p.email)) };
}

/** Auswahl des Empfängers; „niemand“ lässt den Link nur zum Kopieren stehen. */
export function EmpfaengerAuswahl({ organisationId, wert, onChange, pflicht = false }: { organisationId: string; wert: string; onChange: (id: string) => void; pflicht?: boolean }) {
  const t = useT();
  const a = t.mail.abfrage;
  const { kontakte, isPending } = useKontakteMitMail(organisationId);
  if (!isPending && kontakte.length === 0) return <Hinweis>{a.keinKontakt}</Hinweis>;
  return (
    <>
      <Auswahl label={pflicht ? a.empfaenger : a.perMail} value={wert} onChange={(e) => onChange(e.target.value)}>
        {pflicht ? null : <option value="">{a.niemand}</option>}
        {kontakte.map((p) => (
          <option key={p.id} value={p.id}>
            {p.vorname} {p.nachname} ({p.email})
          </option>
        ))}
      </Auswahl>
      {pflicht ? null : <p className="app-leer-text">{a.hilfe}</p>}
    </>
  );
}

/** Link einer offenen Anfrage per Mail senden: erzeugt wie „Neuer Link“ einen neuen Link; er bleibt danach zum Kopieren sichtbar. */
export function PerMailDialog({ name, organisationId, abfrageId, onFertig, onSchliessen }: { name: string; organisationId: string; abfrageId: string; onFertig: (link: AbfrageLink) => void; onSchliessen: () => void }) {
  const t = useT();
  const a = t.mail.abfrage;
  const senden = useAbfragePerMail();
  const { kontakte } = useKontakteMitMail(organisationId);
  const [auswahl, setAuswahl] = useState("");
  const personId = auswahl || kontakte[0]?.id || "";
  return (
    <Seitenpanel titel={a.dialogTitel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">
        {a.dialogTitel}: {name}
      </h2>
      <form
        className="app-formular"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (personId) senden.mutate({ id: abfrageId, personId }, { onSuccess: (r) => onFertig(r.link) });
        }}
      >
        <FehlerHinweis fehler={senden.error} />
        <EmpfaengerAuswahl organisationId={organisationId} wert={personId} onChange={setAuswahl} pflicht />
        <p className="app-leer-text">{a.hilfe}</p>
        <div>
          <Button type="submit" disabled={senden.isPending || !personId}>
            {a.senden}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}
