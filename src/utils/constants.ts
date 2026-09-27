import type { PresetAss } from "../types";

export const VENTANAS_POR_SEGUNDO = 15;
export const EXT_VIDEO = [".mp4", ".mov", ".avi", ".mkv"];
export const EDGE_TRIGGER = 0.92;
export const NEW_MARGIN = 0.08;
export const LERP_FACTOR = 0.12;
export const SNAP_THRESHOLD = 0.15;
export const PALETA = [
  "#E85D4E",
  "#4EA8E8",
  "#7ED957",
  "#E8C34E",
  "#B980E8",
  "#4EE8C3",
];
export const HISTORY_LIMIT = 50;

// ==== Islas de audio (duración inteligente de fragmentos) ====
export const ISLA_VENTANA_FONDO_SEG = 2;
export const ISLA_FACTOR_UMBRAL = 2.5;
export const ISLA_PISO = 0.01;
export const ISLA_HISTERESIS_MUESTRAS = 8;
export const ISLA_MAX_DURACION = 5;
export const ISLA_MIN_DURACION = 1.5;
export const ISLA_FALLBACK = 1.5;

// ==== Export .ass (Advanced SubStation Alpha) ====
export const ASS_PRESETS_ARCHIVO = "presets_ass.json";
// "Arial" y no "Inter": Inter es una fuente de Google que no viene con
// Windows y la app tampoco la declara en @font-face, asi que el .ass caeria
// al fallback en cualquier maquina que no la tenga instalada.
export const DEFAULT_PRESET_ASS: PresetAss = {
  id: "preset-default",
  nombre: "Default",
  fontname: "Arial",
  fontsize: 48,
  color: "#FFFFFF",
  outlineColor: "#000000",
  outline: 2,
  shadow: 1,
  alignment: 2,
  marginL: 10,
  marginR: 10,
  marginV: 40,
};
