import type { CSSProperties } from "react";
import type { Caption, Hablante, PresetAss } from "../types";
import { calcularMargenesV } from "../utils/ass";
import { useLocale } from "../i18n";

interface Props {
  preset: PresetAss;
  hablantes: Hablante[];
  resX: number;
  resY: number;
}

const ANCHO = 640;

function captionsDePrueba(hablantes: Hablante[]): Caption[] {
  const h = (i: number) =>
    hablantes.length > 0 ? (hablantes[i % hablantes.length]?.id ?? null) : null;
  return [
    {
      id: "preview-1",
      inicio: 0,
      fin: 4,
      texto: "Primer hablante con un texto largo para ver el salto de línea",
      hablante_id: h(0),
    },
    {
      id: "preview-2",
      inicio: 2,
      fin: 6,
      texto: "Segundo hablante\ncon dos renglones",
      hablante_id: h(1),
    },
    {
      id: "preview-3",
      inicio: 7,
      fin: 10,
      texto: "Tercero, ya sin solape",
      hablante_id: h(2),
    },
  ];
}

function alineacionHorizontal(a: number): CSSProperties["textAlign"] {
  const col = ((a - 1) % 3) + 1;
  return col === 1 ? "left" : col === 3 ? "right" : "center";
}

// En ASS, MarginV es la distancia desde el borde o ancla hacia el interior, así
// que subir el número aleja el texto del ancla en los tres tercios.
function posicionVertical(
  a: number,
  margenV: number,
  escala: number,
): CSSProperties {
  if (a >= 7) return { top: margenV * escala };
  if (a >= 4) return { top: `calc(50% + ${margenV * escala}px)` };
  return { bottom: margenV * escala };
}

export function AssPreview({ preset, hablantes, resX, resY }: Props) {
  const { t } = useLocale();
  const escala = ANCHO / resX;
  // 3 captions fijos: no hace falta useMemo, son 3 y el cálculo es de microsegundos.
  const caps = captionsDePrueba(hablantes);
  const margenes = calcularMargenesV(caps, preset, resX);

  return (
    <div
      className="assPreview"
      style={
        {
          aspectRatio: `${resX} / ${resY}`,
          paddingLeft: preset.marginL * escala,
          paddingRight: preset.marginR * escala,
          "--o": `${Math.max(0.5, preset.outline * escala)}px`,
          "--oc": preset.outlineColor,
          "--s": `${preset.shadow * escala}px`,
        } as CSSProperties
      }
    >
      {caps.map((c) => {
        const hablante = hablantes.find((h) => h.id === c.hablante_id);
        return (
          <div
            key={c.id}
            className="assPreviewCap"
            style={{
              ...posicionVertical(
                preset.alignment,
                margenes.get(c.id) ?? preset.marginV,
                escala,
              ),
              fontFamily: `"${preset.fontname}", var(--font-body)`,
              fontSize: preset.fontsize * escala,
              color: hablante?.color ?? preset.color,
              textAlign: alineacionHorizontal(preset.alignment),
              whiteSpace: "pre-line",
            }}
          >
            {c.texto}
          </div>
        );
      })}
      {hablantes.length === 0 && (
        <div className="assPreviewVacio">
          {t("assExport.previewNoSpeakers")}
        </div>
      )}
    </div>
  );
}
