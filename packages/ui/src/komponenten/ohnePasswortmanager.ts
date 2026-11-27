/** Fachfelder: `autocomplete="off"` allein ignorieren die meisten Passwortmanager, deshalb zusätzlich ihre eigenen Attribute. */
export const OHNE_PASSWORTMANAGER = {
  autoComplete: "off",
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  "data-form-type": "other",
} as const;
