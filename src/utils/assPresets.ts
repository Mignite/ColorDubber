import { invoke } from "@tauri-apps/api/core";
import { appConfigDir, join } from "@tauri-apps/api/path";
import type { PresetAss } from "../types";
import { ASS_PRESETS_ARCHIVO, DEFAULT_PRESET_ASS } from "./constants";

const CAMPOS_TEXTO = ["id", "nombre", "fontname", "color", "outlineColor"] as const;
const CAMPOS_NUMERO = [
  "fontsize",
  "outline",
  "shadow",
  "alignment",
  "marginL",
  "marginR",
  "marginV",
] as const;

function esPresetAss(valor: unknown): valor is PresetAss {
  if (typeof valor !== "object" || valor === null) return false;
  const v = valor as Record<string, unknown>;
  return (
    CAMPOS_TEXTO.every((c) => typeof v[c] === "string") &&
    CAMPOS_NUMERO.every(
      (c) => typeof v[c] === "number" && Number.isFinite(v[c]),
    )
  );
}

function semilla(): PresetAss[] {
  return [{ ...DEFAULT_PRESET_ASS }];
}

export function presetsDesdeJson(texto: string | null | undefined): PresetAss[] {
  if (!texto) return semilla();
  try {
    const data = JSON.parse(texto) as { presets?: unknown };
    const lista = Array.isArray(data?.presets)
      ? data.presets.filter(esPresetAss)
      : [];
    return lista.length > 0 ? lista : semilla();
  } catch {
    return semilla();
  }
}

export function presetsAJson(presets: PresetAss[]): string {
  return JSON.stringify({ presets }, null, 2);
}

export function nuevoPreset(base: Partial<PresetAss> = {}): PresetAss {
  return {
    ...DEFAULT_PRESET_ASS,
    ...base,
    id: `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  };
}

export async function cargarPresetsAss(): Promise<PresetAss[]> {
  try {
    const ruta = await join(await appConfigDir(), ASS_PRESETS_ARCHIVO);
    return presetsDesdeJson(
      await invoke<string>("leer_archivo_texto", { ruta }),
    );
  } catch {
    // El archivo todavía no existe (primer uso) o no se puede leer: se siembra.
    return semilla();
  }
}

export async function guardarPresetsAss(presets: PresetAss[]): Promise<void> {
  const ruta = await join(await appConfigDir(), ASS_PRESETS_ARCHIVO);
  await invoke("escribir_archivo_texto", {
    ruta,
    contenido: presetsAJson(presets),
  });
}
