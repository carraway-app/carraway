import { useEffect, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Feld } from "@carraway/ui";
import { managerProfil, useProfilAendern } from "../api/portfolio";
import { useT } from "../i18n";
import { FehlerHinweis } from "./FehlerHinweis";
import { WaehrungAuswahl } from "./WaehrungAuswahl";

/** Manager-Profil in der Verwaltung (globale Verwalter): Name und Hauswährung der Installation. */
export function ManagerProfilBereich() {
  const t = useT();
  const p = t.waehrung.profil;
  const { data, error } = useQuery(managerProfil());
  const aendern = useProfilAendern();
  const [name, setName] = useState("");
  const [waehrung, setWaehrung] = useState("EUR");
  useEffect(() => {
    if (data) {
      setName(data.name ?? "");
      setWaehrung(data.homeCurrency);
    }
  }, [data]);
  if (error) return <FehlerHinweis fehler={error} />;
  const absenden = (e: FormEvent) => {
    e.preventDefault();
    aendern.mutate({ name: name.trim() === "" ? null : name.trim(), homeCurrency: waehrung });
  };
  return (
    <form className="app-formular" onSubmit={absenden} aria-label={p.titel}>
      <h2 className="cw-t-untertitel">{p.titel}</h2>
      <p className="app-leer-text">{p.beschreibung}</p>
      <Feld label={p.name} value={name} maxLength={200} onChange={(e) => setName(e.currentTarget.value)} />
      <WaehrungAuswahl label={p.hauswaehrung} value={waehrung} onChange={(e) => setWaehrung(e.target.value)} />
      {aendern.error ? <FehlerHinweis fehler={aendern.error} /> : null}
      {aendern.isSuccess ? <p className="app-leer-text" role="status">{p.gespeichert}</p> : null}
      <Button type="submit" disabled={aendern.isPending || !/^[A-Z]{3}$/.test(waehrung)}>
        {p.speichern}
      </Button>
    </form>
  );
}
