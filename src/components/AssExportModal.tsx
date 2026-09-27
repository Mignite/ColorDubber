import { useEffect, useState } from "react";
import type { Hablante, PresetAss } from "../types";
import { useLocale } from "../i18n";
import { nuevoPreset } from "../utils/assPresets";
import { fuentesDisponibles, fuenteResuelve } from "../utils/fuentes";

interface Props {
  presets: PresetAss[];
  hablantes: Hablante[];
  onCerrar: () => void;
  onExportar: (asignacion: Record<string, string>, presetSinHablante: string) => void;
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
  onCerrar,
  onExportar,
  onGuardar,
}: Props) {
  const { t } = useLocale();
  const [seleccionId, setSeleccionId] = useState<string>(presets[0]?.id ?? "");
  const [borrador, setBorrador] = useState<PresetAss | null>(presets[0] ?? null);
  // Acción que se quiere ejecutar pero primero hay que confirmar el descarte.
  const [pendiente, setPendiente] = useState<(() => void) | null>(null);
  const [fuentes, setFuentes] = useState<string[]>([]);
  const [listaFuentesAbierta, setListaFuentesAbierta] = useState(false);
  // Mapeo hablante -> preset SOLO para este export. No se persiste: no es una
  // propiedad del hablante ni del proyecto, es una decisión de esta exportación.
  const primero = presets[0]?.id ?? "";
  const [asignacion, setAsignacion] = useState<Record<string, string>>({});
  const [presetSinHablante, setPresetSinHablante] = useState<string>(primero);

  const presetDe = (hablanteId: string): string =>
    asignacion[hablanteId] ?? primero;

  // El modal se monta fresco en cada apertura, así que esto corre una vez por
  // apertura (y la promesa está cacheada por sesión).
  useEffect(() => {
    let vivo = true;
    fuentesDisponibles().then((f) => {
      if (vivo) setFuentes(f);
    });
    return () => {
      vivo = false;
    };
  }, []);

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
          <span className="grow" />
          <span className="muted">{t("assExport.assignmentHint")}</span>
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
                <span
                  className="assPresetSwatch"
                  style={{ background: p.color }}
                  aria-hidden="true"
                />
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

          <div className="assRight">
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
                  placeholder={t("assExport.fontPlaceholder")}
                  onFocus={() => setListaFuentesAbierta(true)}
                  onBlur={() => window.setTimeout(() => setListaFuentesAbierta(false), 120)}
                  onChange={(e) => editar("fontname", e.target.value)}
                />
                {listaFuentesAbierta && fuentes.length > 0 && (
                  <div className="assFontList">
                    {borrador.fontname.trim() === "" ? (
                      fuentes.slice(0, 40).map((f) => (
                        <button
                          key={f}
                          className="assFontItem"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            editar("fontname", f);
                            setListaFuentesAbierta(false);
                          }}
                        >
                          {f}
                        </button>
                      ))
                    ) : (
                      fuentes
                        .filter((f) =>
                          f.toLowerCase().includes(borrador.fontname.toLowerCase()),
                        )
                        .slice(0, 40)
                        .map((f) => (
                          <button
                            key={f}
                            className="assFontItem"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              editar("fontname", f);
                              setListaFuentesAbierta(false);
                            }}
                          >
                            {f}
                          </button>
                        ))
                    )}
                    {borrador.fontname.trim() !== "" &&
                      !fuenteResuelve(borrador.fontname) && (
                        <div className="assFontItem muted">
                          {t("assExport.fontNotInstalled")}
                        </div>
                      )}
                  </div>
                )}
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

            <div className="assAssign">
              <div className="assAssignHead">
                <span className="assAssignTitle">
                  {t("assExport.assignment")}
                </span>
                <span className="grow" />
                <button
                  className="assPresetAdd"
                  onClick={() => {
                    const todos: Record<string, string> = {};
                    for (const h of hablantes) todos[h.id] = borrador?.id ?? primero;
                    setAsignacion(todos);
                    setPresetSinHablante(borrador?.id ?? primero);
                  }}
                >
                  {t("assExport.applyToAll")}
                </button>
              </div>
              {hablantes.map((h) => (
                <div className="assAssignRow" key={h.id}>
                  <span
                    className="speakerDot"
                    style={{ background: h.color }}
                    aria-hidden="true"
                  />
                  <span className="assAssignName">
                    {h.nombre || h.tecla || h.id}
                  </span>
                  <span className="grow" />
                  <select
                    value={presetDe(h.id)}
                    onChange={(e) =>
                      setAsignacion((a) => ({ ...a, [h.id]: e.target.value }))
                    }
                  >
                    {presets.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="assAssignRow">
                <span className="assAssignDotSin" aria-hidden="true" />
                <span className="assAssignName muted">
                  {t("assExport.unassigned")}
                </span>
                <span className="grow" />
                <select
                  value={presetSinHablante || primero}
                  onChange={(e) => setPresetSinHablante(e.target.value)}
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

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
            onClick={() => borrador && onExportar(asignacion, presetSinHablante || primero)}
            disabled={!borrador}
          >
            {t("assExport.export")}
          </button>
        </div>
      </div>
    </div>
  );
}
