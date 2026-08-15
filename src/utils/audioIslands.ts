import {
  VENTANAS_POR_SEGUNDO,
  ISLA_VENTANA_FONDO_SEG,
  ISLA_FACTOR_UMBRAL,
  ISLA_PISO,
  ISLA_HISTERESIS_MUESTRAS,
  ISLA_MAX_DURACION,
  ISLA_MIN_DURACION,
} from "./constants";

// Detecta "islas de audio" (zonas de diálogo): tramos donde el RMS supera el
// nivel de fondo local. Devuelve el fin del subtítulo en segundos, o null si
// no hay isla clara en el playhead (el caller usa el fallback).
export function buscarFinIslaAudio(
  volumen: number[],
  inicio: number,
): number | null {
  const vps = VENTANAS_POR_SEGUNDO;
  if (volumen.length === 0) return null;
  const i0 = Math.max(0, Math.floor(inicio * vps));
  if (i0 >= volumen.length) return null;

  // Nivel de fondo: media del RMS en la ventana previa al playhead
  // (~2s), con piso mínimo. En t=0 (sin ventana previa) usa el piso.
  const ventana = Math.round(ISLA_VENTANA_FONDO_SEG * vps);
  const desde = Math.max(0, i0 - ventana);
  let fondo = ISLA_PISO;
  if (desde < i0) {
    let suma = 0;
    for (let i = desde; i < i0; i++) suma += volumen[i];
    fondo = Math.max(suma / (i0 - desde), ISLA_PISO);
  }

  const umbral = Math.max(fondo * ISLA_FACTOR_UMBRAL, ISLA_PISO);

  // Sin isla en el playhead (silencio o ambiente) → fallback.
  if (volumen[i0] < umbral) return null;

  // Barrido con histéresis: tolera micro-pausas dentro de la frase
  // (ISLA_HISTERESIS_MUESTRAS muestras por debajo del umbral antes de cerrar).
  let ultimoAlto = i0;
  let tolerancia = ISLA_HISTERESIS_MUESTRAS;
  for (let j = i0 + 1; j < volumen.length; j++) {
    if (volumen[j] >= umbral) {
      ultimoAlto = j;
      tolerancia = ISLA_HISTERESIS_MUESTRAS;
    } else if (--tolerancia <= 0) {
      break;
    }
  }

  let fin = (ultimoAlto + 1) / vps;
  const finMin = inicio + ISLA_MIN_DURACION;
  const finMax = inicio + ISLA_MAX_DURACION;
  fin = Math.min(fin, finMax);
  if (fin < finMin) fin = finMin;
  return fin;
}
