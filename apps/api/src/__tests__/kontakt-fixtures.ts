import { aufDeutsch, aufEnglisch, deutscherFeldpfad, englischerFeldpfad } from "../kontakte/api-namen";

// Gemeinsame Fach- und UI-Fixtures folgen den internen Datensätzen. Die HTTP-Vertragstests verwenden
// die englischen Routen und HTTP-Körper direkt.
const PFADE = [
  ["/crm/listen/:id/eintraege/entfernen", "/crm/lists/:id/entries/remove"],
  ["/aktivitaeten/:id/anhaenge/:anhangId/importieren", "/activities/:id/attachments/:attachmentId/import"],
  ["/crm/datensaetze/:objekt/:id/karte", "/crm/records/:object/:id/card"],
  ["/crm/datensaetze/:objekt/:id/verknuepfungen", "/crm/records/:object/:id/links"],
  ["/crm/deals/:id/kontakte/:personId", "/crm/deals/:id/contacts/:personId"],
  ["/crm/listen/:id/eintraege/:datensatzId", "/crm/lists/:id/entries/:recordId"],
  ["/crm/aufgaben/:id/erledigt", "/crm/tasks/:id/complete"],
  ["/crm/aufgaben/:id/wieder-oeffnen", "/crm/tasks/:id/reopen"],
  ["/crm/deals/:id/kontakte", "/crm/deals/:id/contacts"],
  ["/crm/felder/:id/archivieren", "/crm/fields/:id/archive"],
  ["/crm/felder/:id/wiederherstellen", "/crm/fields/:id/restore"],
  ["/crm/listen/:id/archivieren", "/crm/lists/:id/archive"],
  ["/crm/listen/:id/eintraege", "/crm/lists/:id/entries"],
  ["/crm/objekte/:objekt/abfrage", "/crm/objects/:object/query"],
  ["/crm/objekte/:objekt/board", "/crm/objects/:object/board"],
  ["/crm/objekte/:objekt/export", "/crm/objects/:object/export"],
  ["/crm/objekte/:objekt/felder", "/crm/objects/:object/fields"],
  ["/crm/objekte/:objekt/gruppen", "/crm/objects/:object/groups"],
  ["/crm/objekte/:objekt/massenaktion", "/crm/objects/:object/bulk-actions"],
  ["/extern/abfragen/:token/einreichen", "/external/requests/:token/submit"],
  ["/organisationen/:id/zusammenfuehren/vorschau", "/organizations/:id/merge/preview"],
  ["/personen/:id/zusammenfuehren/vorschau", "/people/:id/merge/preview"],
  ["/crm/datensaetze/:objekt/:id", "/crm/records/:object/:id"],
  ["/crm/import/kopfzeile", "/crm/import/headers"],
  ["/crm/import/vorschau", "/crm/import/preview"],
  ["/dealflow/trichter/export", "/dealflow/funnel/export"],
  ["/postfach/oauth/start", "/mailbox/oauth/start"],
  ["/aktivitaeten/:id/anhaenge", "/activities/:id/attachments"],
  ["/aktivitaeten/:id/erledigt", "/activities/:id/complete"],
  ["/aktivitaeten/:id/sync-entfernen", "/activities/:id/remove-sync"],
  ["/aktivitaeten/:id/zurueckstellen", "/activities/:id/reschedule"],
  ["/beteiligungen/:id/felder", "/investments/:id/fields"],
  ["/beteiligungen/:id/instrumentfelder", "/investments/:id/instrument-fields"],
  ["/crm/ansichten/:id", "/crm/views/:id"],
  ["/crm/aufgaben/:id", "/crm/tasks/:id"],
  ["/crm/beschaeftigungen/:id", "/crm/employments/:id"],
  ["/crm/felder/:id", "/crm/fields/:id"],
  ["/crm/listen/:id", "/crm/lists/:id"],
  ["/deals/:id/absage", "/deals/:id/decline"],
  ["/deals/:id/beschluesse", "/deals/:id/resolutions"],
  ["/deals/:id/beschlussvorschlag", "/deals/:id/draft-resolution"],
  ["/deals/:id/beteiligung", "/deals/:id/investment"],
  ["/deals/:id/phase", "/deals/:id/stage"],
  ["/deals/:id/wiederaufnahme", "/deals/:id/reopen"],
  ["/deals/:id/zuordnung", "/deals/:id/assignment"],
  ["/deals/:id/zustaendige", "/deals/:id/assignees"],
  ["/extern/abfragen/:token", "/external/requests/:token"],
  ["/finanzierungsrunden/:id/felder", "/financing-rounds/:id/fields"],
  ["/fonds/:id/felder", "/funds/:id/fields"],
  ["/kontaktvorschlaege/:id/uebernehmen", "/contact-suggestions/:id/accept"],
  ["/kontaktvorschlaege/:id/verwerfen", "/contact-suggestions/:id/dismiss"],
  ["/kontaktvorschlaege/:id/zusammenfuehren", "/contact-suggestions/:id/merge"],
  ["/organisationen/:id/zusammenfuehren", "/organizations/:id/merge"],
  ["/personen/:id/zusammenfuehren", "/people/:id/merge"],
  ["/postfach/:id/abgleichen", "/mailbox/:id/sync"],
  ["/vorgaenge/:id/felder", "/transactions/:id/fields"],
  ["/zusatzfelder/:objekt/definitionen", "/custom-fields/:object/definitions"],
  ["/zusatzfelder/:objekt/schema", "/custom-fields/:object/schema"],
  ["/crm/ansichten", "/crm/views"],
  ["/crm/aufgaben", "/crm/tasks"],
  ["/crm/beschaeftigungen", "/crm/employments"],
  ["/crm/felder", "/crm/fields"],
  ["/crm/import", "/crm/import"],
  ["/crm/listen", "/crm/lists"],
  ["/crm/zustaendige", "/crm/assignees"],
  ["/dealflow/arbeitsliste", "/dealflow/worklist"],
  ["/dealflow/kartenfelder", "/dealflow/card-fields"],
  ["/dealflow/trichter", "/dealflow/funnel"],
  ["/kontaktimport/vorlage", "/contact-import/template"],
  ["/kontaktimport/vorschau", "/contact-import/preview"],
  ["/kontaktvorschlaege/einstellung", "/contact-suggestions/settings"],
  ["/mail/auftraege", "/mail/jobs"],
  ["/mail/status", "/mail/status"],
  ["/mail/test", "/mail/test"],
  ["/organisationen/dubletten", "/organizations/duplicates"],
  ["/personen/dubletten", "/people/duplicates"],
  ["/postfach/imap", "/mailbox/imap"],
  ["/postfach/kontakte", "/mailbox/contacts"],
  ["/postfach/rueckruf", "/mailbox/callback"],
  ["/wiedervorlagen/anzahl", "/follow-ups/count"],
  ["/wiedervorlagen/zusammenfassung", "/follow-ups/summary"],
  ["/deals/:id", "/deals/:id"],
  ["/kalender/:datei", "/calendar/:file"],
  ["/kontaktrollen/:id", "/contact-roles/:id"],
  ["/organisationen/:id", "/organizations/:id"],
  ["/organisationsbeziehungen/:id", "/organization-relationships/:id"],
  ["/personen/:id", "/people/:id"],
  ["/postfach/:id", "/mailbox/:id"],
  ["/aktivitaeten", "/activities"],
  ["/deals", "/deals"],
  ["/kontaktimport", "/contact-import"],
  ["/kontaktrollen", "/contact-roles"],
  ["/kontaktvorschlaege", "/contact-suggestions"],
  ["/organisationen", "/organizations"],
  ["/organisationsbeziehungen", "/organization-relationships"],
  ["/personen", "/people"],
  ["/postfach", "/mailbox"],
  ["/suche", "/search"],
  ["/termine", "/meetings"],
  ["/wiedervorlagen", "/follow-ups"],
] as const;

function pfadAbbilden(pfad: string, englisch: boolean): string | undefined {
  const segmente = pfad.replace(/\/$/, "").slice(1).split("/");
  for (const paar of PFADE) {
    const eingabe = paar[englisch ? 0 : 1].slice(1).split("/");
    if (eingabe.length !== segmente.length || eingabe.some((s, i) => !s.startsWith(":") && s !== segmente[i])) continue;
    const crmObjekt = eingabe.slice(0, 2).some((s) => ["custom-fields", "zusatzfelder", "objects", "objekte", "records", "datensaetze"].includes(s));
    const ausgabe = paar[englisch ? 1 : 0].slice(1).split("/");
    return "/" + ausgabe.map((s, i) => {
      if (!s.startsWith(":")) return s;
      const wert = segmente[i]!;
      if (crmObjekt && (s === ":object" || s === ":objekt")) {
        return englisch ? aufEnglisch({ objekt: wert }).object : aufDeutsch({ object: wert }).objekt;
      }
      return wert;
    }).join("/");
  }
}

const istCrm = (pfad: string) => pfad.startsWith("/crm/") || pfad.startsWith("/dealflow/");

export function kontaktFixtureUrl(pfad: string, englisch: boolean) {
  const url = new URL(pfad, "http://localhost");
  const praefix = url.pathname.startsWith("/api/v1/") ? "/api/v1" : "";
  const relativ = url.pathname.slice(praefix.length);
  const ziel = pfadAbbilden(relativ, englisch);
  if (ziel === undefined) return null;
  const abfrage = Object.fromEntries(url.searchParams);
  const parameter = englisch ? aufEnglisch(abfrage, istCrm(relativ)) : aufDeutsch(abfrage, istCrm(relativ));
  const query = new URLSearchParams(parameter);
  return { pfad: praefix + ziel, query, crm: istCrm(relativ) };
}

export function kontaktFixtureJson(wert: unknown, englisch: boolean, crm: boolean, gruppenfeld?: string): unknown {
  if (wert && typeof wert === "object" && "error" in wert && wert.error && typeof wert.error === "object") {
    const { fields, ...fehler } = wert.error as { fields?: { field: string; code: string; message: string }[] };
    const abbilden = englisch ? englischerFeldpfad : deutscherFeldpfad;
    return { error: {
      ...(englisch ? aufEnglisch(fehler, crm) : aufDeutsch(fehler, crm)),
      ...(fields ? { fields: fields.map((f) => ({ ...f, field: abbilden(f.field) })) } : {}),
    } };
  }
  return englisch ? aufEnglisch(wert, crm, gruppenfeld) : aufDeutsch(wert, crm, undefined, gruppenfeld);
}
