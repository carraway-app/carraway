import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Feld as Eingabe } from "@carraway/ui";
import { crmDealKontakte, useDealKontaktHinzufuegen } from "../../api/crm";
import { FehlerHinweis } from "../FehlerHinweis";
import { PersonSuchfeld } from "../NeuAnlegenFelder";
import type { SuchfeldTreffer } from "../Suchfeld";
import { useT } from "../../i18n";
import { Datensatzlink } from "./Datensatzlink";
import { Schnellaktionen } from "./Zelle";

/** Kontakte eines Deals (neben dem Unternehmen) mit Rolle und Schnellaktionen. */
export function DealKontakteAbschnitt({ dealId, schreiben }: { dealId: string; schreiben: boolean }) {
  const t = useT();
  const abfrage = useQuery(crmDealKontakte(dealId));
  const hinzufuegen = useDealKontaktHinzufuegen(dealId);
  const [gewaehlt, setGewaehlt] = useState<SuchfeldTreffer | null>(null);
  const [rolle, setRolle] = useState("");
  const zeilen = abfrage.data ?? [];
  return (
    <section className="app-karte" aria-label={t.crm.dealKontakte}>
      <h3 className="cw-t-untertitel app-karte__titel">{t.crm.dealKontakte}</h3>
      <FehlerHinweis fehler={abfrage.error ?? hinzufuegen.error} />
      {abfrage.data && zeilen.length === 0 ? <p className="app-leer-text">{t.crm.keineDealKontakte}</p> : null}
      <ul className="app-verknuepfungen">
        {zeilen.map((k) => (
          <li key={k.personId}>
            <Datensatzlink objekt="person" id={k.personId}>{`${k.vorname} ${k.nachname}`}</Datensatzlink>
            <Schnellaktionen werte={{ email: k.email, telefon: k.telefon }} name={`${k.vorname} ${k.nachname}`} />
            <span className="app-dubletten__info">{[k.rolle, k.funktion].filter(Boolean).join(" · ")}</span>
          </li>
        ))}
      </ul>
      {schreiben ? (
        <form
          className="app-formular"
          noValidate
          aria-label={t.crm.dealKontaktNeu}
          onSubmit={(e) => {
            e.preventDefault();
            if (!gewaehlt) return;
            hinzufuegen.mutate(
              { personId: gewaehlt.id, ...(rolle.trim() ? { rolle: rolle.trim() } : {}) },
              {
                onSuccess: () => {
                  setGewaehlt(null);
                  setRolle("");
                },
              },
            );
          }}
        >
          <PersonSuchfeld label={t.crm.kontaktWaehlen} wert={gewaehlt} onWahl={setGewaehlt} />
          <Eingabe label={t.crm.rolle} value={rolle} onChange={(e) => setRolle(e.target.value)} />
          <div>
            <Button type="submit" disabled={!gewaehlt || hinzufuegen.isPending}>
              {t.crm.verknuepfen}
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
