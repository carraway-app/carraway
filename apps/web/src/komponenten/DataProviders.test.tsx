import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it } from "vitest";
import { ORG_A, rendereApp, spieleApi } from "../test/hilfen";

afterEach(() => localStorage.removeItem("carraway.sprache"));
it.each(["de", "en"])("configures a provider through the administration page in %s", async lang => {
  localStorage.setItem("carraway.sprache", lang);
  const api = spieleApi({
    "/api/v1/data-providers": { koerper: { data: [{ id: "north-data", label: "North Data", calls: 0, configured: false }] } },
    "PUT /api/v1/data-providers/north-data": { koerper: { saved: true } },
  });
  rendereApp("/administration?tab=data-providers");
  const user = userEvent.setup();
  const key = await screen.findByLabelText(lang === "de" ? "API-Schlüssel" : "API key", { selector: "input" });
  expect(key.getAttribute("type")).toBe("password");
  await user.type(key, "fixture-key");
  await user.click(screen.getByRole("button", { name: lang === "de" ? "Speichern" : "Save" }));
  await waitFor(() => expect(api.anfragen("PUT", "/api/v1/data-providers/north-data")[0]?.koerper).toEqual({ credential: "fixture-key", monthlyLimit: null }));
  await waitFor(() => expect((key as HTMLInputElement).value).toBe(""));
});
it("shows field evidence and submits an individual review", async () => {
  const path = "/api/v1/organizations/" + ORG_A + "/provider-data";
  const api = spieleApi({
    [path]: { koerper: { providers: [], provenance: [], data: [{
      id: "suggestion", provider: "north-data", field: "city", value: "Example City", previousValue: "Local City",
      retrievedAt: "2026-01-01T00:00:00Z", sourceUrl: "https://registry.example/company", current: true, status: "pending",
    }] } },
    ["POST " + path + "/suggestion/review"]: { koerper: { reviewed: true } },
  });
  rendereApp("/organizations/" + ORG_A + "?tab=register");
  expect(await screen.findByText("Example City")).toBeTruthy();
  expect(screen.getByRole("link", { name: "north-data" }).getAttribute("href")).toBe("https://registry.example/company");
  await userEvent.setup().click(screen.getByRole("button", { name: "Übernehmen" }));
  await waitFor(() => expect(api.anfragen("POST", path + "/suggestion/review")[0]?.koerper).toMatchObject({ decision: "accepted" }));
});
