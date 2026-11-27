import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { Auswahl, Button, Etikett, Feld, Hinweis, Segment, Status } from "@carraway/ui";
import {
  kalenderLinkStatus,
  mailEinstellungen,
  postfachUebersicht,
  useEinstellungenAendern,
  useImapVerbinden,
  useKalenderLinkErzeugen,
  useKalenderLinkWiderrufen,
  useOAuthStart,
  usePostfachAbgleichen,
  usePostfachInhalt,
  usePostfachTrennen,
  type KalenderLinkErgebnis,
  type PostfachVerbindung,
} from "../api/mail";
import { alle } from "../erweiterung";
import { Seitenpanel } from "@carraway/ui";
import { FehlerHinweis } from "../komponenten/FehlerHinweis";
import SicherheitKarten from "../komponenten/SicherheitKarten";
import { KontakteTeilnahmeKarte } from "../komponenten/KontakteAusPostfach";
import { ThemaWahl } from "../komponenten/ThemaWahl";
import { EinstellungenKopf } from "../komponenten/EinstellungenKopf";
import { eigeneSeite, useEinstellungenReiterListe } from "../komponenten/einstellungenReiter";
import { Skelettzeilen } from "../komponenten/Skelett";
import { aufzaehlung, useSprache, useT } from "../i18n";
import { navigation } from "../lib/navigation";
import { useTabs } from "../lib/tabs";
import { formatZeitpunkt } from "../lib/zeit";

const route = getRouteApi("/settings/mailbox");

/** Persönliche Einstellungen (Etappe 17): Mails von Carraway, Anbindung von Postfach und Kalender, Kalenderabonnement. Alles gilt nur für die angemeldete Person. */
export function EinstellungenPostfachSeite() {
  const suche = route.useSearch();
  const navigate = route.useNavigate();
  // Nach der Rückkehr von der Anbieterseite steht das Postfach im Mittelpunkt.
  const erlaubt = useEinstellungenReiterListe().filter((id) => !eigeneSeite(id));
  const { tab, setzeTab } = useTabs(suche.tab || !(suche.ergebnis || suche.fehler) ? suche : { ...suche, tab: "postfach" }, navigate, erlaubt);
  return (
    <EinstellungenKopf
      aktiv={tab}
      vorReitern={<Rueckkehr />}
      onWechsel={(id) => {
        const ziel = eigeneSeite(id);
        if (ziel) void navigate({ to: ziel as never, search: {} as never });
        else setzeTab(id);
      }}
      inhalte={{
        benachrichtigungen: () => <MailEinstellungenKarte />,
        postfach: () => (
          <>
            <PostfachKarte />
            <KontakteTeilnahmeKarte />
            {alle("postfachEinstellungen").map((E, i) => (
              <E key={i} />
            ))}
          </>
        ),
        kalender: () => <KalenderKarte />,
        darstellung: () => <DarstellungKarte />,
        sicherheit: () => <SicherheitKarten />,
      }}
    />
  );
}

/** Meldung nach der Rückkehr von der Anbieterseite (Adresse trägt nur Codes, nie Tokens). */
function Rueckkehr() {
  const t = useT();
  const r = t.mail.einstellungen.postfach.rueckkehr;
  const { ergebnis, bereich, fehler, grund } = route.useSearch();
  if (ergebnis === "verbunden") return <Hinweis>{r.verbunden(aufzaehlung(t.mail.einstellungen.postfach.bereich, bereich ?? "mail"))}</Hinweis>;
  if (!fehler) return null;
  const text = fehler === "mailbox_state_invalid" ? r.zustand : fehler === "mailbox_provider_disabled" ? r.anbieterAus : r.fehlgeschlagen;
  return (
    <Hinweis variante="fehler">
      {text}
      {grund ? ` (${grund})` : ""}
    </Hinweis>
  );
}

/** Darstellung: Thema der Oberfläche (System, Hell, Dunkel), je Person gespeichert; dieselbe Wahl wie im Kontomenü. */
function DarstellungKarte() {
  const d = useT().konto.thema;
  return (
    <section className="app-karte" aria-labelledby="einst-thema">
      <h2 id="einst-thema" className="cw-t-untertitel app-karte__titel">
        {d.beschriftung}
      </h2>
      <div className="app-formular">
        <div className="app-gruppe">
          <ThemaWahl texte={d} aria-labelledby="einst-thema" />
        </div>
        <p className="app-leer-text">{d.hilfe}</p>
      </div>
    </section>
  );
}

function MailEinstellungenKarte() {
  const t = useT();
  const m = t.mail.einstellungen.mails;
  const abfrage = useQuery(mailEinstellungen());
  const aendern = useEinstellungenAendern();
  const [gespeichert, setGespeichert] = useState(false);
  const speichern = (werte: { sprache?: "de" | "en"; mailBerichtFreigegeben?: boolean; mailRegisterEreignis?: boolean }) => {
    setGespeichert(false);
    aendern.mutate(werte, { onSuccess: () => setGespeichert(true) });
  };
  return (
    <section className="app-karte" aria-labelledby="einst-mails">
      <h2 id="einst-mails" className="cw-t-untertitel app-karte__titel">
        {m.titel}
      </h2>
      {abfrage.isPending ? <Skelettzeilen /> : null}
      <FehlerHinweis fehler={abfrage.error ?? aendern.error} />
      {abfrage.data ? (
        <div className="app-formular">
          {!abfrage.data.mailVerfuegbar ? <Hinweis>{m.nichtVerfuegbar}</Hinweis> : null}
          <div className="app-gruppe">
            <span className="cw-feld__label" id="einst-mail-sprache">
              {m.sprache}
            </span>
            <Segment<"de" | "en">
              aria-labelledby="einst-mail-sprache"
              value={abfrage.data.sprache}
              onChange={(sprache) => speichern({ sprache })}
              options={[
                { wert: "de", label: aufzaehlung(t.bericht.sprachen, "de") },
                { wert: "en", label: aufzaehlung(t.bericht.sprachen, "en") },
              ]}
            />
          </div>
          <label className="app-schalter">
            <input type="checkbox" checked={abfrage.data.mailBerichtFreigegeben} disabled={aendern.isPending} onChange={(ev) => speichern({ mailBerichtFreigegeben: ev.target.checked })} />
            <span>{m.berichtOptIn}</span>
          </label>
          <p className="app-leer-text">{m.berichtHilfe}</p>
          <label className="app-schalter">
            <input type="checkbox" checked={abfrage.data.mailRegisterEreignis} disabled={aendern.isPending} onChange={(ev) => speichern({ mailRegisterEreignis: ev.target.checked })} />
            <span>{m.registerOptIn}</span>
          </label>
          <p className="app-leer-text">{m.registerHilfe}</p>
          <p role="status">{gespeichert ? m.gespeichert : ""}</p>
        </div>
      ) : null}
    </section>
  );
}

const BEREICHE = ["mail", "kalender"] as const;

function PostfachKarte() {
  const t = useT();
  const p = t.mail.einstellungen.postfach;
  const abfrage = useQuery(postfachUebersicht());
  const [zugestimmt, setZugestimmt] = useState(false);
  const [trennen, setTrennen] = useState<PostfachVerbindung | null>(null);
  const daten = abfrage.data;
  return (
    <section className="app-karte" aria-labelledby="einst-postfach">
      <h2 id="einst-postfach" className="cw-t-untertitel app-karte__titel">
        {p.titel}
      </h2>
      <p>{p.einleitung}</p>
      <Hinweis titel={p.datenschutz.titel}>
        <ul>
          {p.datenschutz.punkte.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </Hinweis>
      <label className="app-schalter">
        <input type="checkbox" checked={zugestimmt} onChange={(ev) => setZugestimmt(ev.target.checked)} />
        <span>{p.zustimmung}</span>
      </label>
      {abfrage.isPending ? <Skelettzeilen /> : null}
      <FehlerHinweis fehler={abfrage.error} />
      {daten ? (
        <>
          {!daten.schluesselVorhanden ? <Hinweis variante="fehler">{p.schluesselFehlt}</Hinweis> : null}
          {!daten.anbieter.microsoft && !daten.anbieter.google && !daten.anbieter.imap ? <Hinweis>{p.keinAnbieter}</Hinweis> : null}
          <div className="app-postfach-raster">
            {BEREICHE.map((bereich) => (
              <BereichZeile
                key={bereich}
                bereich={bereich}
                verbindung={daten.verbindungen.find((v) => v.bereich === bereich) ?? null}
                anbieter={daten.anbieter}
                kannVerbinden={zugestimmt && daten.schluesselVorhanden}
                onTrennen={setTrennen}
              />
            ))}
          </div>
        </>
      ) : null}
      {trennen ? <TrennenDialog verbindung={trennen} onSchliessen={() => setTrennen(null)} /> : null}
    </section>
  );
}

function BereichZeile({
  bereich,
  verbindung,
  anbieter,
  kannVerbinden,
  onTrennen,
}: {
  bereich: (typeof BEREICHE)[number];
  verbindung: PostfachVerbindung | null;
  anbieter: { microsoft: boolean; google: boolean; imap: boolean };
  kannVerbinden: boolean;
  onTrennen: (v: PostfachVerbindung) => void;
}) {
  const t = useT();
  const p = t.mail.einstellungen.postfach;
  const sprache = useSprache();
  const name = aufzaehlung(p.bereich, bereich);
  const start = useOAuthStart();
  const abgleichen = usePostfachAbgleichen();
  const inhalt = usePostfachInhalt();
  const [imapOffen, setImapOffen] = useState(false);
  const [angefordert, setAngefordert] = useState(false);

  const oauth = (a: "microsoft" | "google") => start.mutate({ anbieter: a, bereich }, { onSuccess: (r) => navigation.zu(r.url) });
  const oauthAnbieter = (["microsoft", "google"] as const).filter((a) => anbieter[a]);
  return (
    <div className="app-postfach-zeile">
      <h3 className="app-gruppen-titel">{name}</h3>
      {verbindung ? (
        <>
          <p className="app-zusammenhang">
            <Etikett>{p.verbundenMit(aufzaehlung(p.anbieter, verbindung.anbieter), verbindung.adresse)}</Etikett>
            <Status variante={verbindung.status === "verbunden" ? "freigegeben" : verbindung.status === "fehler" ? "pruefung" : "fehlt"}>{aufzaehlung(p.status, verbindung.status)}</Status>
          </p>
          <p className="app-leer-text">
            {p.letzterAbgleich}: {verbindung.letzterAbgleichAm ? formatZeitpunkt(verbindung.letzterAbgleichAm, sprache) : p.nie}
            {verbindung.letzterFehler ? ` · ${aufzaehlung(p.abgleichFehler, verbindung.letzterFehler)} (${p.fehlerCode} ${verbindung.letzterFehler})` : ""}
          </p>
          {bereich === "mail" ? (
            <>
              <label className="app-schalter">
                <input type="checkbox" checked={verbindung.inhaltSpeichern} disabled={inhalt.isPending} onChange={(ev) => inhalt.mutate({ id: verbindung.id, inhaltSpeichern: ev.target.checked })} />
                <span>{p.inhalt}</span>
              </label>
              <p className="app-leer-text">{p.inhaltHilfe}</p>
            </>
          ) : null}
          <FehlerHinweis fehler={inhalt.error ?? abgleichen.error} />
          <div className="app-zusammenhang">
            <Button
              variante="sekundaer"
              aria-label={p.abgleichenFuer(name)}
              disabled={abgleichen.isPending}
              onClick={() => abgleichen.mutate(verbindung.id, { onSuccess: () => setAngefordert(true) })}
            >
              {p.abgleichen}
            </Button>
            <Button variante="ruhig" aria-label={p.trennenFuer(name)} onClick={() => onTrennen(verbindung)}>
              {p.trennen}
            </Button>
          </div>
          <p role="status">{angefordert ? p.abgleichAngefordert : ""}</p>
        </>
      ) : (
        <>
          <p className="app-leer-text">{p.nichtVerbunden}</p>
          <FehlerHinweis fehler={start.error} />
          <div className="app-zusammenhang">
            {oauthAnbieter.map((a) => (
              <Button key={a} variante="sekundaer" disabled={!kannVerbinden || start.isPending} onClick={() => oauth(a)}>
                {p.verbinden(name, aufzaehlung(p.anbieter, a))}
              </Button>
            ))}
            {bereich === "mail" && anbieter.imap ? (
              <Button variante="sekundaer" disabled={!kannVerbinden} onClick={() => setImapOffen(true)}>
                {p.verbinden(name, aufzaehlung(p.anbieter, "imap"))}
              </Button>
            ) : null}
          </div>
        </>
      )}
      {imapOffen ? <ImapDialog onSchliessen={() => setImapOffen(false)} /> : null}
    </div>
  );
}

function TrennenDialog({ verbindung, onSchliessen }: { verbindung: PostfachVerbindung; onSchliessen: () => void }) {
  const t = useT();
  const p = t.mail.einstellungen.postfach;
  const trennen = usePostfachTrennen();
  const name = aufzaehlung(p.bereich, verbindung.bereich);
  return (
    <Seitenpanel titel={p.trennenFuer(name)} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{p.trennenFuer(name)}</h2>
      <p>{p.trennenHinweis}</p>
      <FehlerHinweis fehler={trennen.error} />
      <div className="app-zusammenhang">
        <Button disabled={trennen.isPending} onClick={() => trennen.mutate(verbindung.id, { onSuccess: onSchliessen })}>
          {p.trennen}
        </Button>
        <Button variante="sekundaer" onClick={onSchliessen}>
          {t.mail.zeitstrahl.abbrechen}
        </Button>
      </div>
    </Seitenpanel>
  );
}

function ImapDialog({ onSchliessen }: { onSchliessen: () => void }) {
  const t = useT();
  const i = t.mail.einstellungen.postfach.imap;
  const verbinden = useImapVerbinden();
  const [werte, setWerte] = useState({ host: "", port: "993", sicherheit: "tls" as "tls" | "starttls" | "keine", benutzer: "", passwort: "", adresse: "", ordner: "INBOX", inhaltSpeichern: false });
  const setze = (name: keyof typeof werte) => (ev: { target: { value: string } }) => setWerte((w) => ({ ...w, [name]: ev.target.value }));
  return (
    <Seitenpanel titel={i.titel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{i.titel}</h2>
      <Hinweis>{i.hinweis}</Hinweis>
      <form
        className="app-formular"
        noValidate
        onSubmit={(ev) => {
          ev.preventDefault();
          verbinden.mutate(
            {
              host: werte.host.trim(),
              port: Number(werte.port),
              sicherheit: werte.sicherheit,
              benutzer: werte.benutzer.trim(),
              passwort: werte.passwort,
              adresse: werte.adresse.trim(),
              ordner: werte.ordner.split(",").map((o) => o.trim()).filter(Boolean),
              inhaltSpeichern: werte.inhaltSpeichern,
              zustimmung: true,
            },
            { onSuccess: onSchliessen },
          );
        }}
      >
        <FehlerHinweis fehler={verbinden.error} />
        <Feld label={i.host} value={werte.host} onChange={setze("host")} />
        <Feld label={i.port} type="number" value={werte.port} onChange={setze("port")} />
        <Auswahl label={i.sicherheit} value={werte.sicherheit} onChange={setze("sicherheit")}>
          {(["tls", "starttls", "keine"] as const).map((s) => (
            <option key={s} value={s}>
              {aufzaehlung(i.sicherheitWerte, s)}
            </option>
          ))}
        </Auswahl>
        <Feld label={i.benutzer} value={werte.benutzer} onChange={setze("benutzer")} />
        <Feld label={i.passwort} type="password" value={werte.passwort} onChange={setze("passwort")} autoComplete="new-password" />
        <Feld label={i.adresse} type="email" value={werte.adresse} onChange={setze("adresse")} />
        <Feld label={i.ordner} hilfe={i.ordnerHilfe} value={werte.ordner} onChange={setze("ordner")} />
        <div>
          <Button type="submit" disabled={verbinden.isPending}>
            {i.verbinden}
          </Button>
        </div>
      </form>
    </Seitenpanel>
  );
}

function KalenderKarte() {
  const t = useT();
  const k = t.mail.einstellungen.kalender;
  const sprache = useSprache();
  const status = useQuery(kalenderLinkStatus());
  const erzeugen = useKalenderLinkErzeugen();
  const widerrufen = useKalenderLinkWiderrufen();
  const [link, setLink] = useState<KalenderLinkErgebnis | null>(null);
  const aktiv = status.data?.aktiv ?? false;
  return (
    <section className="app-karte" aria-labelledby="einst-kalender">
      <h2 id="einst-kalender" className="cw-t-untertitel app-karte__titel">
        {k.titel}
      </h2>
      <p>{k.beschreibung}</p>
      <FehlerHinweis fehler={status.error ?? erzeugen.error ?? widerrufen.error} />
      {status.data ? (
        <>
          <p>
            <Status variante={aktiv ? "freigegeben" : "fehlt"}>{aktiv ? k.aktiv : k.inaktiv}</Status>
            {aktiv ? (
              <span className="app-leer-text">
                {" "}
                {k.letzterAbruf}: {status.data.letzterZugriffAm ? formatZeitpunkt(status.data.letzterZugriffAm, sprache) : t.mail.einstellungen.postfach.nie}
              </span>
            ) : null}
          </p>
          {aktiv ? <p className="app-leer-text">{k.ersetzenHinweis}</p> : null}
          <div className="app-zusammenhang">
            <Button variante="sekundaer" disabled={erzeugen.isPending} onClick={() => erzeugen.mutate(undefined, { onSuccess: setLink })}>
              {aktiv ? k.ersetzen : k.erzeugen}
            </Button>
            {aktiv ? (
              <Button variante="ruhig" disabled={widerrufen.isPending} onClick={() => widerrufen.mutate()}>
                {k.widerrufen}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      {link ? <KalenderLinkDialog link={link} onSchliessen={() => setLink(null)} /> : null}
    </section>
  );
}

/** Zeigt den Link einmalig zum Kopieren; in der Datenbank steht nur der Hash. */
function KalenderLinkDialog({ link, onSchliessen }: { link: KalenderLinkErgebnis; onSchliessen: () => void }) {
  const t = useT();
  const k = t.mail.einstellungen.kalender;
  const [stand, setStand] = useState<"ok" | "fehler" | null>(null);
  const url = link.url || `${window.location.origin}${link.pfad}`;
  async function kopieren() {
    try {
      await navigator.clipboard.writeText(url);
      setStand("ok");
    } catch {
      setStand("fehler");
    }
  }
  return (
    <Seitenpanel titel={k.dialogTitel} onSchliessen={onSchliessen}>
      <h2 className="cw-t-untertitel">{k.dialogTitel}</h2>
      <Hinweis>{k.einmalig}</Hinweis>
      <Feld label={k.feld} className="app-kz-link" value={url} readOnly onFocus={(ev) => ev.currentTarget.select()} />
      <Button onClick={() => void kopieren()}>{k.kopieren}</Button>
      <p role="status">{stand === "ok" ? k.kopiert : stand === "fehler" ? k.kopierFehler : ""}</p>
    </Seitenpanel>
  );
}
