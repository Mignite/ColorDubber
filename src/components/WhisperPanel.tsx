import { memo } from "react";
import type { ModeloInfo, TrackInfo, TranscripcionProgreso } from "../types";

interface Props {
  modelos: ModeloInfo[];
  modeloSeleccionado: string;
  descargandoModelo: string | null;
  progresoDescarga: number;
  estadoDescarga: string;
  errorDescarga: string | null;
  bytesDescargados: number;
  bytesTotal: number;
  panelAbierto: boolean;
  transcribiendo: boolean;
  transcripcionProgreso: TranscripcionProgreso | null;
  errorTranscripcion: string | null;
  tracks: TrackInfo[];
  tracksSeleccionados: number[];
  glosarioGlobal: string;
  glosario: string;
  idioma: string;
  modoMuestreo: string;
  onTogglePanel: () => void;
  onSelectModelo: (id: string) => void;
  onDescargarModelo: (id: string) => void;
  onEliminarModelo: (id: string) => void;
  onTranscribir: () => void;
  onToggleTrack: (index: number) => void;
  onGlosarioGlobalChange: (v: string) => void;
  onGlosarioChange: (v: string) => void;
  onIdiomaChange: (v: string) => void;
  onModoMuestreoChange: (v: string) => void;
}

function WhisperPanel({
  modelos, modeloSeleccionado, descargandoModelo, progresoDescarga,
  estadoDescarga, errorDescarga, bytesDescargados, bytesTotal,
  panelAbierto, transcribiendo, transcripcionProgreso, errorTranscripcion,
  tracks, tracksSeleccionados, glosarioGlobal, glosario,
  idioma, modoMuestreo,
  onTogglePanel, onSelectModelo, onDescargarModelo, onEliminarModelo,
  onTranscribir, onToggleTrack, onGlosarioGlobalChange, onGlosarioChange,
  onIdiomaChange, onModoMuestreoChange,
}: Props) {
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

  const chipSvg = (
    <svg
      className="icon"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
    >
      <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" />
      <path d="M6.2 1.8v2.7M9.8 1.8v2.7M6.2 11.5v2.7M9.8 11.5v2.7M1.8 6.2h2.7M1.8 9.8h2.7M11.5 6.2h2.7M11.5 9.8h2.7" />
    </svg>
  );

  const checkSvg = (
    <svg
      className="icon xs"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 8.5l3.5 3.5L13.5 4.5" />
    </svg>
  );

  const warnSvg = (
    <svg
      className="icon sm"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinejoin="round"
    >
      <path d="M8 1.8 14.6 13H1.4z" />
      <path d="M8 6v3.2" />
      <circle cx="8" cy="11.4" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );

  return (
    <div className="speakersAccordion">
      <button className="speakersAccordionHeader" onClick={onTogglePanel}>
        <span>{chipSvg} Modelos Whisper</span>
        {chevronSvg}
      </button>
      {panelAbierto && (
        <div className="speakersPanel">
          {modelos.map((m) => (
            <div key={m.id} className="modeloRowInner">
              <div className="modeloRowFlex">
                <div
                  className={"modeloInfo" + (modeloSeleccionado === m.id ? " selected" : "")}
                  onClick={() => m.descargado && onSelectModelo(m.id)}
                >
                  <span>{m.label}</span>
                  <span className="modeloSize">{m.tamano_mb_aprox} MB</span>
                </div>
                {m.descargado ? (
                  <>
                    {modeloSeleccionado === m.id && <span className="modeloActivo">{checkSvg} activo</span>}
                    <button className="iconBtnSmall" onClick={() => onEliminarModelo(m.id)}>Borrar</button>
                  </>
                ) : descargandoModelo === m.id ? (
                  <span className="modeloProgreso">
                    {(progresoDescarga * 100).toFixed(0)}%
                  </span>
                ) : (
                  <button onClick={() => onDescargarModelo(m.id)}>Descargar</button>
                )}
              </div>

              {descargandoModelo === m.id && (
                <div className="downloadProgressContainer">
                  <div className="downloadProgressTrack">
                    <div className="downloadProgressFill" style={{ width: (progresoDescarga * 100).toFixed(1) + "%" }} />
                  </div>
                  <div className="downloadInfoRow">
                    <span>
                      {estadoDescarga === "conectando" && (
                        <span className="connectingState">
                          <svg
                            className="icon sm spin"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.6}
                            strokeLinecap="round"
                          >
                            <path d="M8 1.8a6.2 6.2 0 1 1-6.2 6.2" />
                          </svg>
                          Conectando...
                        </span>
                      )}
                      {estadoDescarga === "descargando" && (
                        <span className="connectingState">
                          <svg
                            className="icon sm"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={1.5}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M8 2v8.5M4.5 7.5 8 11l3.5-3.5" />
                            <path d="M2.5 13.5h11" />
                          </svg>
                          {(bytesDescargados / 1024 / 1024).toFixed(1) + " / " + (bytesTotal / 1024 / 1024).toFixed(0) + " MB"}
                        </span>
                      )}
                      {estadoDescarga === "completo" && (
                        <span className="connectingState">{checkSvg} Completado</span>
                      )}
                    </span>
                    <span>{(progresoDescarga * 100).toFixed(0)}%</span>
                  </div>
                </div>
              )}

              {errorDescarga && !descargandoModelo && (
                <div className="downloadErrorBox">
                  {warnSvg} {errorDescarga}
                </div>
              )}

              {errorTranscripcion && !transcribiendo && (
                <div className="downloadErrorBox">
                  {warnSvg} Error de transcripción: {errorTranscripcion}
                </div>
              )}
            </div>
          ))}

          <div className="trackSection">
            <div className="trackSectionTitle">
              Selecciona pistas de audio para Whisper:
            </div>
            <div className="trackList">
              {tracks.map((t) => (
                <label key={t.index} className="trackCheckLabel">
                  <input
                    type="checkbox"
                    checked={tracksSeleccionados.includes(t.index)}
                    onChange={() => onToggleTrack(t.index)}
                  />
                  {(t.nombre || "Track " + (t.index + 1)) + " (" + t.canales + "ch)"}
                </label>
              ))}
            </div>
            {tracksSeleccionados.length === 0 && (
              <div className="trackWarning">
                {warnSvg} Selecciona al menos una pista
              </div>
            )}
          </div>

          <div className="glossarySection">
            <div className="glossaryLabel">Glosario global (persiste entre proyectos)</div>
            <input
              type="text"
              value={glosarioGlobal}
              onChange={(e) => onGlosarioGlobalChange(e.target.value)}
              placeholder="Mignite, L, Gasben, Mid, Operator, GG"
              className="glossaryInput"
              title="T\u00E9rminos que se aplican a todos los proyectos"
            />
          </div>
          <div className="glossarySection">
            <div className="glossaryLabel">Glosario del proyecto</div>
            <input
              type="text"
              value={glosario}
              onChange={(e) => onGlosarioChange(e.target.value)}
              placeholder="Nacho, Mid, Operator, GG"
              className="glossaryInput"
              title="Palabras clave para ayudar a Whisper a escribirlas correctamente"
            />
          </div>
          <div className="whisperConfigRow">
            <div className="whisperConfigItem">
              <label className="whisperConfigLabel">Idioma</label>
              <select
                className="whisperSelect"
                value={idioma}
                onChange={(e) => onIdiomaChange(e.target.value)}
                disabled={transcribiendo}
              >
                <option value="es">Español</option>
                <option value="en">Inglés</option>
                <option value="auto">Auto-detectar</option>
                <option value="pt">Portugués</option>
                <option value="fr">Francés</option>
                <option value="it">Italiano</option>
                <option value="de">Alemán</option>
                <option value="ja">Japonés</option>
                <option value="zh">Chino</option>
              </select>
            </div>
            <div className="whisperConfigItem">
              <label className="whisperConfigLabel">Modo</label>
              <select
                className="whisperSelect"
                value={modoMuestreo}
                onChange={(e) => onModoMuestreoChange(e.target.value)}
                disabled={transcribiendo}
              >
                <option value="beam5">Alta Precisión (Beam 5)</option>
                <option value="greedy">Rápido (Greedy)</option>
              </select>
            </div>
          </div>

          <button
            className="addFragmentBtn"
            onClick={onTranscribir}
            disabled={transcribiendo || !modeloSeleccionado || tracksSeleccionados.length === 0}
          >
            {transcribiendo
              ? (transcripcionProgreso?.mensaje ?? "Transcribiendo...") + (transcripcionProgreso ? " (" + transcripcionProgreso.progreso + "%)" : "")
              : "Transcribir con Whisper (" + tracksSeleccionados.length + " track" + (tracksSeleccionados.length > 1 ? "s" : "") + " seleccionado" + (tracksSeleccionados.length > 1 ? "s" : "") + ")"}
          </button>
          {transcribiendo && transcripcionProgreso && (
            <div className="transcriptionProgressTrack">
              <div className="transcriptionProgressFill" style={{ width: transcripcionProgreso.progreso + "%" }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(WhisperPanel);
