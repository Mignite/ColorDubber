import { memo } from "react";
import type { Hablante } from "../types";

interface Props {
  hablantes: Hablante[];
  panelAbierto: boolean;
  onTogglePanel: () => void;
  onAgregar: () => void;
  onActualizar: (id: string, campo: keyof Hablante, valor: string) => void;
  onEliminar: (id: string) => void;
  onCommit: () => void;
}

function SpeakersPanel({ hablantes, panelAbierto, onTogglePanel, onAgregar, onActualizar, onEliminar, onCommit }: Props) {
  return (
    <div className="speakersAccordion">
      <button className="speakersAccordionHeader" onClick={onTogglePanel}>
        <span>👥 Hablantes ({hablantes.length})</span>
        <span>{panelAbierto ? "▲" : "▼"}</span>
      </button>
      {panelAbierto && (
        <div className="speakersPanel">
          {hablantes.map((h) => (
            <div key={h.id} className="speakerRow">
              <span className="speakerDot" style={{ backgroundColor: h.color }} />
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
              <button className="iconBtnSmall" onClick={() => onEliminar(h.id)}>
                ✕
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
