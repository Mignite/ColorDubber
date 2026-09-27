import { useState } from "react";
import type { Hablante, PresetAss } from "../types";
import { useLocale } from "../i18n";
import { nuevoPreset } from "../utils/assPresets";
import { AssPreview } from "./AssPreview";

interface Props {
  presets: PresetAss[];
  hablantes: Hablante[];
  resX: number;
  resY: number;
  onCerrar: () => void;
  onExportar: (preset: PresetAss) => void;
  onGuardar: (presets: PresetAss[]) => void;
}

const ALINEACIONES: { valor: number; etiqueta: string }[] = [
  { valor: 1, etiqueta: "1 Abajo izq." },
  { valor: 2, etiqueta: "2 Abajo centro" },
  { valor: 3, etiqueta: "3 Abajo der." },
  { valor: 4, etiqueta: "4 Medio izq." },
  { valor: 5, etiqueta: "5 Medio centro" },
  { valor: 6, etiqueta: "6 Medio der." },
  { valor: 7, etiqueta: "7 Arriba izq." },
  { valor: 8, etiqueta: "8 Arriba centro" },
  { valor: 9, etiqueta: "9 Arriba der." },
];

const CAMPOS_NUMERO: (keyof PresetAss)[] = [
  "fontsize",
  "outline",
  "shadow",
  "marginL",
  "marginR",
  "marginV",
];

/** "Default" -> "Default 2", y si ya existe "Default 3". Evita el
 *  "Default copia copia" de concatenar la palabra cada vez. */
function nombreLibre(base: string, existentes: string[]): string {
  const limpio = base.replace(/\s+\d+$/, "");
  let n = 2;
  while (existentes.includes(`${limpio} ${n}`)) n++;
  return `${limpio} ${n}`;
}

export function AssExportModal({
  presets,
  hablantes,
  resX,
  resY,
  onCerrar,
  onExportar,
  onGuardar,
}: Props) {
  const { t } = useLocale();
  const [seleccionId, setSeleccionId] = useState<string>(presets[0]?.id ?? "");
  const [borrador, setBorrador] = useState<PresetAss | null>(presets[0] ?? null);
  // Acción que se quiere ejecutar pero primero hay que confirmar el descarte.
  const [pendiente, setPendiente] = useState<(() => void) | null>(null);

  const original = presets.find((p) => p.id === seleccionId) ?? null;
  const sucio =
    borrador !== null && original !== null
      ? JSON.stringify(borrador) !== JSON.stringify(original)
      : false;

  /** Toda acción que descartaría los cambios pasa por acá: o se ejecuta, o se
   *  pide confirmación. Nunca se pierde trabajo en silencio. */
  const conConfirmacion = (accion: () => void) => {
    if (sucio) {
      setPendiente(() => accion);
      return;
    }
    accion();
  };

  const editar = <C extends keyof PresetAss>(
    campo: C,
    valor: PresetAss[C],
  ) => {
    setBorrador((b) => (b ? { ...b, [campo]: valor } : b));
  };

  const seleccionar = (id: string) => {
    conConfirmacion(() => {
      const p = presets.find((x) => x.id === id);
      if (p) {
        setSeleccionId(id);
        setBorrador(p);
      }
    });
  };

  const guardar = () => {
    if (!borrador) return;
    const existe = presets.some((p) => p.id === borrador.id);
    onGuardar(
      existe
        ? presets.map((p) => (p.id === borrador.id ? borrador : p))
        : [...presets, borrador],
    );
    setSeleccionId(borrador.id);
  };

  const agregarPreset = () => {
    // Parte del preset actual: casi siempre querés tweaked lo que ya te gusta,
    // no volver de cero. El nombre se renumera solo.
    const base = nombreLibre(borrador?.nombre ?? "Preset", presets.map((p) => p.nombre));
    const nuevo = nuevoPreset({ ...borrador, nombre: base });
    onGuardar([...presets, nuevo]);
    setSeleccionId(nuevo.id);
    setBorrador(nuevo);
  };

  const borrar = () => {
    if (!borrador || presets.length <= 1) return;
    const resto = presets.filter((p) => p.id !== borrador.id);
    onGuardar(resto);
    setSeleccionId(resto[0].id);
    setBorrador(resto[0]);
  };

  return (
    <div className="assOverlay" onClick={() => conConfirmacion(onCerrar)}>
      <div className="assModal" onClick={(e) => e.stopPropagation()}>
        <div className="assModalHead">
          <h2>{t("assExport.title")}</h2>
          <span className="assPreviewLabel">
            {resX}x{resY}
          </span>
        </div>

        <div className="assBody">
          <div className="assPresetList">
            {presets.map((p) => (
              <button
                key={p.id}
                className={
                  "assPresetItem" + (p.id === seleccionId ? " activo" : "")
                }
                onClick={() => seleccionar(p.id)}
              >
                {p.nombre}
              </button>
            ))}
            <div className="assPresetActions">
              <button
                className="assPresetAdd"
                onClick={agregarPreset}
                title={t("assExport.newPreset")}
              >
                <span className="assPresetAddPlus" aria-hidden="true">
                  +
                </span>
                {t("assExport.newPreset")}
              </button>
              <button
                className="assPresetDel"
                onClick={borrar}
                disabled={presets.length <= 1}
                title={t("assExport.delete")}
              >
                {t("assExport.delete")}
              </button>
            </div>
          </div>

          {borrador && (
            <div className="assFields">
              <div className="assField">
                <label>{t("assExport.field_nombre")}</label>
                <input
                  value={borrador.nombre}
                  onChange={(e) => editar("nombre", e.target.value)}
                />
              </div>
              <div className="assField">
                <label>{t("assExport.field_fontname")}</label>
                <input
                  value={borrador.fontname}
                  list="assFuentes"
                  onChange={(e) => editar("fontname", e.target.value)}
                />
                <datalist id="assFuentes">
                  <option value="Inter" />
                  <option value="Space Grotesk" />
                  <option value="JetBrains Mono" />
                </datalist>
              </div>
              {CAMPOS_NUMERO.map((campo) => (
                <div className="assField" key={campo}>
                  <label>{t(`assExport.field_${campo}`)}</label>
                  <input
                    type="number"
                    value={borrador[campo] as number}
                    onChange={(e) =>
                      editar(campo, Number(e.target.value) || 0)
                    }
                  />
                </div>
              ))}
              <div className="assField">
                <label>{t("assExport.field_alignment")}</label>
                <select
                  value={borrador.alignment}
                  onChange={(e) => editar("alignment", Number(e.target.value))}
                >
                  {ALINEACIONES.map((a) => (
                    <option key={a.valor} value={a.valor}>
                      {a.etiqueta}
                    </option>
                  ))}
                </select>
              </div>
              <div className="assField">
                <label>{t("assExport.field_color")}</label>
                <input
                  type="color"
                  value={borrador.color}
                  onChange={(e) => editar("color", e.target.value)}
                />
              </div>
              <div className="assField">
                <label>{t("assExport.field_outlineColor")}</label>
                <input
                  type="color"
                  value={borrador.outlineColor}
                  onChange={(e) => editar("outlineColor", e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {borrador && (
          <div className="assPreviewWrap">
            <div className="assPreviewLabel">{t("assExport.preview")}</div>
            <AssPreview
              preset={borrador}
              hablantes={hablantes}
              resX={resX}
              resY={resY}
            />
          </div>
        )}

        {pendiente && (
          <div className="assUnsaved">
            <span className="grow">{t("assExport.unsaved")}</span>
            <button
              className="addFragmentBtn"
              onClick={() => {
                const accion = pendiente;
                setPendiente(null);
                accion();
              }}
            >
              {t("assExport.discard")}
            </button>
            <button
              className="addFragmentBtn"
              onClick={() => setPendiente(null)}
            >
              {t("assExport.keepEditing")}
            </button>
          </div>
        )}

        <div className="assFooter">
          <span className="grow" />
          <button
            className="addFragmentBtn"
            onClick={() => conConfirmacion(onCerrar)}
          >
            {t("assExport.close")}
          </button>
          <button className="addFragmentBtn" onClick={guardar} disabled={!borrador}>
            {t("assExport.save")}
          </button>
          <button
            className="addFragmentBtn primary"
            onClick={() => borrador && onExportar(borrador)}
            disabled={!borrador}
          >
            {t("assExport.export")}
          </button>
        </div>
      </div>
    </div>
  );
}
