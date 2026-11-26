import type { Abrufer } from "./http";
import { erstelleGoogle } from "./google";
import { erstelleImap, type ImapFabrik } from "./imap";
import { erstelleMicrosoft } from "./microsoft";
import type { PostfachKonfiguration } from "./konfiguration";
import { FakeAnbieter, erzeugeDemoDaten, type DemoKontakt } from "./fake";
import { PostfachFehler, type PostfachAnbieter, type Zugang } from "./typen";
import type { Aufloeser } from "./ziel";

/** Wählt den Adapter je Anbieter. `demo` gibt es nur außerhalb des Echtbestands und liefert erfundene Daten mit Kontakten aus dem CRM. */
export function erstelleAnbieterFabrik(opt: {
  konfig: PostfachKonfiguration;
  abrufer: Abrufer;
  imapFabrik: ImapFabrik;
  aufloeser?: Aufloeser;
  umgebung: string;
  demoKontakte?: () => Promise<DemoKontakt[]>;
  jetzt?: () => Date;
}) {
  return async (anbieter: "microsoft" | "google" | "imap" | "demo", zugang: Zugang): Promise<PostfachAnbieter> => {
    if (anbieter === "microsoft") {
      if (!opt.konfig.microsoft) throw new PostfachFehler("ANBIETER_NICHT_EINGERICHTET");
      return erstelleMicrosoft(opt.konfig.microsoft, opt.abrufer);
    }
    if (anbieter === "google") {
      if (!opt.konfig.google) throw new PostfachFehler("ANBIETER_NICHT_EINGERICHTET");
      return erstelleGoogle(opt.konfig.google, opt.abrufer);
    }
    if (anbieter === "imap") {
      if (!opt.konfig.imap) throw new PostfachFehler("ANBIETER_NICHT_EINGERICHTET");
      return erstelleImap({ fabrik: opt.imapFabrik, privateZiele: opt.konfig.privateZiele, aufloeser: opt.aufloeser });
    }
    if (opt.umgebung === "echt" || !opt.demoKontakte) throw new PostfachFehler("ANBIETER_NICHT_EINGERICHTET");
    const fake = new FakeAnbieter();
    const daten = erzeugeDemoDaten(await opt.demoKontakte(), zugang.adresse, (opt.jetzt ?? (() => new Date()))());
    fake.mails = daten.mails;
    fake.termine = daten.termine;
    fake.texte = daten.texte;
    return fake;
  };
}
