import en from "./en.json";
import es from "./es.json";

export type Locale = "en" | "es";

const STORAGE_KEY = "colordubber_locale";

const dictionaries: Record<Locale, Record<string, string>> = { en, es };

let currentLocale: Locale = "en";
let initialized = false;

export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "es") {
      currentLocale = stored;
      initialized = true;
      if (typeof document !== "undefined") document.documentElement.lang = stored;
      return stored;
    }
  } catch {
    // localStorage not available (SSR/tests)
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  const locale: Locale = nav.toLowerCase().startsWith("es") ? "es" : "en";
  currentLocale = locale;
  initialized = true;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  return locale;
}

export function getLocale(): Locale {
  if (!initialized) return detectLocale();
  return currentLocale;
}

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  initialized = true;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
  if (typeof document !== "undefined") document.documentElement.lang = locale;
  // notify hook listeners via custom event (future toggle)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("colordubber:locale", { detail: locale }));
  }
}

export function t(key: string, vars?: Record<string, string | number>): string {
  const locale = getLocale();
  const dict = dictionaries[locale] ?? dictionaries.en;
  const fallback = dictionaries.en;
  let template: string | undefined = dict[key] ?? fallback[key];
  if (template === undefined) return key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = vars[k];
    return v !== undefined ? String(v) : `{${k}}`;
  });
}

// React hook for future re-render on locale change (no toggle UI yet, but ready)
import { useState, useEffect } from "react";
export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void; t: typeof t } {
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<Locale>).detail;
      if (detail === "en" || detail === "es") setLocaleState(detail);
      else setLocaleState(getLocale());
    };
    window.addEventListener("colordubber:locale", handler as EventListener);
    window.addEventListener("storage", handler as EventListener);
    return () => {
      window.removeEventListener("colordubber:locale", handler as EventListener);
      window.removeEventListener("storage", handler as EventListener);
    };
  }, []);
  return {
    locale,
    setLocale: (l: Locale) => {
      setLocale(l);
      setLocaleState(l);
    },
    t,
  };
}
