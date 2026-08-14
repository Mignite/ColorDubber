import { memo } from "react";
import type { Hablante } from "../types";

interface Props {
  hablantes: Hablante[];
  panelAbierto: boolean;
  onTogglePanel: () => void;
  onAgregar: () => void;
  onActualizar: (id: string, campo: keyof Hablante, valor: string) => void;
  onCambiarColor: (id: string, color: string) => void;
  onEliminar: (id: string) => void;
  onCommit: () => void;
}

function normalizarColor(color: string): string {
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return (
      "#" +
      color[1] +
      color[1] +
      color[2] +
      color[2] +
      color[3] +
      color[3]
    );
  }
  return color;
}

function SpeakersPanel({ hablantes, panelAbierto, onTogglePanel, onAgregar, onActualizar, onCambiarColor, onEliminar, onCommit }: Props) {
  const usersSvg = (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
    >
      <circle cx="6" cy="5.5" r="2.6" />
      <path d="M1.8 13.5c0-2.5 1.9-4 4.2-4s4.2 1.5 4.2 4" />
      <circle cx="11.5" cy="6" r="2.2" />
      <path d="M11 9.7c2.1.2 3.4 1.6 3.4 3.8" />
    </svg>
  );

  const chevronSvg = (
    <svg
      className={"icon xs chevron" + (panelAbierto ? " up" : "")}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
    >
      <path d="M3 6l5 5 5-5" />
    </svg>
  );

  const xSvg = (
    <svg
      className="icon xs"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
    >
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  );

  return (
    <div className="speakersAccordion">
      <button className="speakersAccordionHeader" onClick={onTogglePanel}>
        <span>{usersSvg} Hablantes ({hablantes.length})</span>
        {chevronSvg}
      </button>
      {panelAbierto && (
        <div className="speakersPanel">
          {hablantes.map((h) => (
            <div key={h.id} className="speakerRow">
              <label className="speakerDotWrap" title="Cambiar color">
                <span
                  className="speakerDot"
                  style={{ backgroundColor: h.color }}
                />
                <input
                  type="color"
                  value={normalizarColor(h.color)}
                  onChange={(e) => onCambiarColor(h.id, e.target.value)}
                  className="speakerColorInput"
                />
              </label>
              <input
                className="speakerInput"
                placeholder="Nombre..."
                value={h.nombre}
                onFocus={onCommit}
                onChange={(e) => onActualizar(h.id, "nombre", e.target.value)}
              />
              <input
                className="speakerKeyInput"
                maxLength={1}
                value={h.tecla}
                onFocus={onCommit}
                onChange={(e) => onActualizar(h.id, "tecla", e.target.value)}
                title="Tecla rápida para asignar"
              />
              <button className="iconBtnSmall" onClick={() => onEliminar(h.id)} title="Eliminar hablante">
                {xSvg}
              </button>
            </div>
          ))}
          {hablantes.length < 9 && (
            <button className="addSpeakerBtn" onClick={onAgregar}>
              + Añadir hablante
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(SpeakersPanel);