import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Auswahl, Button, Hinweis, Leer, Seitenkopf, Status, Tabelle, type TabelleSpalte } from "@carraway/ui";
import { mailAuftraege, useMailTest, versandStatus, type MailAuftrag } from "../api/mail";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import { Skelettzeilen } from "../komponenten/Skelett";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { formatZeitpunkt } from "../lib/zeit";

type Filter = "" | "wartend" | "gesendet" | "fehlgeschlagen";

/** Verwaltung des Mailversands (nur globale Verwalter): Status der Einrichtung ohne Geheimnisse, Testmail an die eigene Adresse, Ausgangskorb ohne Inhalte. */
export function MailversandSeite() {
  const t = useT();
  const v = t.mail.versand;
  const sprache = useSprache();
  const status = useQuery(versandStatus());
  const test = useMailTest();
  const [filter, setFilter] = useState<Filter>("");
  const auftraege = useQuery(mailAuftraege(filter || undefined));
  const [angelegt, setAngelegt] = useState(false);
  const s = status.data;

  const spalten: TabelleSpalte<MailAuftrag>[] = [
    { schluessel: "empfaenger", kopf: v.korb.spalten.empfaenger, zelle: (z) => z.empfaenger },
    { schluessel: "vorlage", kopf: v.korb.spalten.vorlage, zelle: (z) => aufzaehlung(v.korb.vorlagen, z.vorlage) },
    { schluessel: "betreff", kopf: v.korb.spalten.betreff, umbruch: true, zelle: (z) => z.betreff },
    {
      schluessel: "status",
      kopf: v.korb.spalten.status,
      zelle: (z) => <Status variante={z.status === "gesendet" ? "freigegeben" : z.status === "wartend" ? "pruefung" : "fehlt"}>{aufzaehlung(v.korb.status, z.status)}</Status>,
    },
    { schluessel: "versuche", kopf: v.korb.spalten.versuche, zelle: (z) => z.versuche, zahl: true },
    { schluessel: "fehler", kopf: v.korb.spalten.fehler, umbruch: true, zelle: (z) => z.letzterFehler ?? t.gemeinsam.keinWert },
    { schluessel: "angelegt", kopf: v.korb.spalten.angelegt, zelle: (z) => formatZeitpunkt(z.erstelltAm, sprache) },
    { schluessel: "gesendet", kopf: v.korb.spalten.gesendet, zelle: (z) => (z.gesendetAm ? formatZeitpunkt(z.gesendetAm, sprache) : t.gemeinsam.keinWert) },
  ];

  return (
    <div className="app-seite">
      <Seitenkopf meta={t.nav.verwaltung} titel={v.titel} />
      <p className="app-leer-text">{v.beschreibung}</p>

      <section className="app-karte" aria-labelledby="mv-status">
        <h2 id="mv-status" className="cw-t-untertitel app-karte__titel">
          {v.status.titel}
        </h2>
        <FehlerHinweis fehler={status.error} />
        {status.isPending ? <Skelettzeilen /> : null}
        {s && !s.konfiguriert ? <Hinweis>{v.status.aus}</Hinweis> : null}
        {s ? (
          <dl className="app-fakten">
            {s.konfiguriert ? (
              <>
                <div>
                  <dt>{v.status.host}</dt>
                  <dd>
                    {s.host}:{s.port}
                  </dd>
                </div>
                <div>
                  <dt>{v.status.absender}</dt>
                  <dd>{s.absender}</dd>
                </div>
                <div>
                  <dt>{v.status.tls}</dt>
                  <dd>{aufzaehlung(v.status.tlsWerte, s.tls)}</dd>
                </div>
                <div>
                  <dt>{v.status.anmeldung}</dt>
                  <dd>{s.mitAnmeldung ? v.status.mit : v.status.ohne}</dd>
                </div>
                <div>
                  <dt>{v.status.limit}</dt>
                  <dd className="app-zahl">{s.limitProStunde}</dd>
                </div>
              </>
            ) : null}
            <div>
              <dt>{v.status.schluessel}</dt>
              <dd>{s.schluesselVorhanden ? v.status.vorhanden : v.status.fehlt}</dd>
            </div>
            <div>
              <dt>{v.status.korb}</dt>
              <dd>
                {aufzaehlung(v.korb.status, "wartend")}: <span className="app-zahl">{s.ausgangskorb.wartend}</span> · {aufzaehlung(v.korb.status, "fehlgeschlagen")}: <span className="app-zahl">{s.ausgangskorb.fehlgeschlagen}</span>
              </dd>
            </div>
          </dl>
        ) : null}
        {s?.konfiguriert ? (
          <div className="app-formular">
            <div>
              <Button variante="sekundaer" disabled={test.isPending} onClick={() => test.mutate(undefined, { onSuccess: () => setAngelegt(true) })}>
                {v.test.knopf}
              </Button>
            </div>
            <p className="app-leer-text">{v.test.hilfe}</p>
            <FehlerHinweis fehler={test.error} />
            <p role="status">{angelegt ? v.test.angelegt : ""}</p>
          </div>
        ) : null}
      </section>

      <section className="app-karte" aria-labelledby="mv-korb">
        <h2 id="mv-korb" className="cw-t-untertitel app-karte__titel">
          {v.korb.titel}
        </h2>
        <p className="app-leer-text">{v.korb.hinweis}</p>
        <Auswahl label={v.korb.filter} value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="">{v.korb.alle}</option>
          {(["wartend", "gesendet", "fehlgeschlagen"] as const).map((x) => (
            <option key={x} value={x}>
              {aufzaehlung(v.korb.status, x)}
            </option>
          ))}
        </Auswahl>
        <FehlerHinweis fehler={auftraege.error} />
        {auftraege.isPending ? <Skelettzeilen /> : null}
        {auftraege.data && auftraege.data.length === 0 ? <Leer zeichen="M" titel={v.korb.keine} beschreibung="" /> : null}
        {auftraege.data && auftraege.data.length > 0 ? <Tabelle beschriftung={v.korb.tabelle} spalten={spalten} zeilen={auftraege.data} zeilenSchluessel={(z) => z.id} /> : null}
      </section>
    </div>
  );
}
