import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open, save, ask } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type {
  Hablante,
  Caption,
  Proyecto,
  ModeloInfo,
  SegmentoTranscrito,
  TrackInfo,
  TranscripcionProgreso,
  ModeloDescargaEvent,
} from "./types";
import {
  VENTANAS_POR_SEGUNDO,
  EXT_VIDEO,
  EDGE_TRIGGER,
  NEW_MARGIN,
  LERP_FACTOR,
  PALETA,
} from "./utils/constants";
import { formatTime, parseTimeInput } from "./utils/time";
import { parseSrt, buildSrt, formatSrtTimestamp } from "./utils/srt";
import {
  BuildOverlapReport,
  FormatOverlapReport,
  findSnapTime,
} from "./utils/captions";
import { filtrarPorMarquee, captionRowIndex } from "./utils/selection";

import { useHistory } from "./hooks/useHistory";
import SpeakersPanel from "./components/SpeakersPanel";
import WhisperPanel from "./components/WhisperPanel";
import CaptionList from "./components/CaptionList";
import "./App.css";

// Carriles por hablante en el timeline: altura fija por carril y tope de
// carriles visibles antes de activar el scroll interno (el handle inferior
// permite expandir hasta el doble).
const TRACK_H = 14;
const TRACK_VISIBLE = 4;
const TRACK_MAX = 8;
const TRACK_HANDLE_H = 16;
const WAVEFORM_H = 56;
const TRACK_LABEL_W = 42;

function App() {
  const [modelos, setModelos] = useState<ModeloInfo[]>([]);
  const [modeloSeleccionado, setModeloSeleccionado] = useState<string>("");
  const [descargandoModelo, setDescargandoModelo] = useState<string | null>(
    null,
  );
  const [progresoDescarga, setProgresoDescarga] = useState<number>(0);
  const [estadoDescarga, setEstadoDescarga] = useState<string>("");
  const [errorDescarga, setErrorDescarga] = useState<string | null>(null);
  const [bytesDescargados, setBytesDescargados] = useState<number>(0);
  const [bytesTotal, setBytesTotal] = useState<number>(0);
  const descargandoModeloRef = useRef<string | null>(null);
  const [panelModelosAbierto, setPanelModelosAbierto] =
    useState<boolean>(false);
  const [videoSrc, setVideoSrc] = useState<string>("");
  const [selectedCaptionIds, setSelectedCaptionIds] = useState<string[]>([]);
  const selectedCaptionId = selectedCaptionIds.length
    ? selectedCaptionIds[selectedCaptionIds.length - 1]
    : null;
  const [videoPath, setVideoPath] = useState<string>("");
  const [rutaProyecto, setRutaProyecto] = useState<string>("");
  const [videoNoEncontrado, setVideoNoEncontrado] = useState<boolean>(false);
  const [rutaFaltante, setRutaFaltante] = useState<string>("");
  const [volumen, setVolumen] = useState<number[]>([]);
  const [analizando, setAnalizando] = useState<boolean>(false);
  const [playheadTime, setPlayheadTime] = useState<number>(0);
  const [windowSeconds, setWindowSeconds] = useState<number>(10);
  const [windowStart, setWindowStart] = useState<number>(0);
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [arrastrando, setArrastrando] = useState<boolean>(false);
  const [reproduciendo, setReproduciendo] = useState<boolean>(false);
  const [hablantes, setHablantes] = useState<Hablante[]>([]);
  const [panelHablantesAbierto, setPanelHablantesAbierto] =
    useState<boolean>(false);
  const [timeInputValue, setTimeInputValue] = useState<string>("");
  const [editandoTiempo, setEditandoTiempo] = useState<boolean>(false);
  const [transcribiendo, setTranscribiendo] = useState<boolean>(false);
  const [errorTranscripcion, setErrorTranscripcion] = useState<string | null>(null);
  const [transcripcionProgreso, setTranscripcionProgreso] = useState<{
    fase: string;
    progreso: number;
    mensaje: string;
  } | null>(null);
  const [extrayendo, setExtrayendo] = useState<boolean>(false);
  const [autoFollowing, setAutoFollowing] = useState<boolean>(true);
  const autoFollowingRef = useRef(true);
  const [glosario, setGlosario] = useState<string>("");
  const glosarioRef = useRef("");
  const [glosarioGlobal, setGlosarioGlobal] = useState<string>("");
  const glosarioGlobalRef = useRef("");
  const [idiomaWhisper, setIdiomaWhisper] = useState<string>("es");
  const idiomaWhisperRef = useRef("es");
  const [modoMuestreoWhisper, setModoMuestreoWhisper] = useState<string>("beam5");
  const modoMuestreoWhisperRef = useRef("beam5");
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const isScrollingManuallyRef = useRef(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const textEditorRef = useRef<HTMLTextAreaElement>(null);
  const wasPlayingBeforeEditRef = useRef(false);
  // Snapshot del historial en focus del editor: evita pasos de undo vacíos
  const skipEditorHistoryRef = useRef(false);
  const editorPushedCaptionsRef = useRef<Caption[] | null>(null);
  const editorPushedHablantesRef = useRef<Hablante[] | null>(null);

  // Refs para drag del playhead
  const isDraggingPlayheadRef = useRef(false);
  const wasPlayingBeforeSeekRef = useRef<boolean>(false);

  // Refs para drag de bordes de subtítulos - MODIFICADO
  const isDraggingCaptionEdgeRef = useRef<{
    captionId: string;
    edge: "start" | "end";
  } | null>(null);
  const dragStartXRef = useRef<number>(0);
  const dragStartTimeRef = useRef<number>(0);
  // NUEVO: ref para el tiempo actual durante el arrastre (feedback visual)
  const dragCurrentTimeRef = useRef<number>(0);
  // Click sin arrastre tras un edge-drag: el wrapper `click` debe ignorarse
  // (el borde ya manejó todo y el seek del click pausaría el video)
  const justFinishedEdgeDragRef = useRef(false);
  // Ref para el canvas context y evitar re-renders durante el drag
  const canvasCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement>(null);
  const clipboardTextRef = useRef("");

  const updateScrollbarThumb = useCallback((ws: number, wSec: number, dur: number) => {
    const thumb = scrollbarThumbRef.current;
    if (!thumb || dur <= 0) return;
    const thumbWidthPct = (wSec / dur) * 100;
    const range = Math.max(1, dur - wSec);
    const leftPct = dur > wSec ? (ws / range) * (100 - thumbWidthPct) : 0;
    thumb.style.left = `${leftPct}%`;
    thumb.style.width = `${Math.min(thumbWidthPct, 100)}%`;
  }, []);

  const windowStartRef = useRef(0);
  const windowTargetRef = useRef(0);
  const windowSecondsRef = useRef(windowSeconds);
  const captionsRef = useRef<Caption[]>([]);
  const sortedByStartRef = useRef<Caption[]>([]);
  const trackAreaRef = useRef<HTMLDivElement | null>(null);
  const trackHandleRef = useRef<HTMLDivElement | null>(null);
  const trackHandleDraggingRef = useRef(false);
  const playheadLineRef = useRef<HTMLDivElement | null>(null);

  const hablantesRef = useRef<Hablante[]>([]);
  const speakerMapRef = useRef<Map<string, Hablante>>(new Map());
  const waveformPreRenderRef = useRef<HTMLCanvasElement | null>(null);
  const currentCaptionIdxRef = useRef<number>(-1);

  const rutaProyectoRef = useRef("");
  const videoPathRef = useRef("");
  const volumenRef = useRef<number[]>([]);
  const analisisVolumenRequestRef = useRef(0);
  const selectedCaptionIdsRef = useRef<string[]>([]);
  const bodyDragRef = useRef<{
    ids: string[];
    deltaT: number;
    startTimes: Map<string, number>;
    moved: boolean;
    els: Map<string, HTMLElement>;
    filaOrigen: Map<string, number>;
    targetFila: number;
    lastX: number;
    lastY: number;
    ctrlDown: boolean;
  } | null>(null);
  const justFinishedBodyDragRef = useRef(false);
  const marqueeStateRef = useRef<{
    startX: number;
    startY: number;
    active: boolean;
    modo: "replace" | "add" | "toggle";
  } | null>(null);
  const marqueeOverlayRef = useRef<HTMLDivElement | null>(null);
  const [exportMensaje, setExportMensaje] = useState<string>("");
  const [showHelp, setShowHelp] = useState(false);
  const { pushHistorial, deshacer, rehacer } = useHistory(
    captionsRef,
    hablantesRef,
    setCaptions,
    setHablantes,
  );
  const playheadFrameSkipRef = useRef(0);
  const dragScrollVelocityRef = useRef(0);
  const isDirtyRef = useRef(false);
  const [hayCambios, setHayCambios] = useState(false);
  const ignoreNextChangeRef = useRef(true);

  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [trackSeleccionado, setTrackSeleccionado] = useState<number | null>(
    null,
  );

  const [tracksSeleccionados, setTracksSeleccionados] = useState<number[]>([]);
  const tracksSeleccionadosRef = useRef<number[]>([]);
  const modeloSeleccionadoRef = useRef("");

  // ===== FUNCIONES WHISPER =====
  const cargarModelos = useCallback(async () => {
    const lista = await invoke<ModeloInfo[]>("listar_modelos");
    setModelos(lista);
    if (!modeloSeleccionadoRef.current) {
      const primero = lista.find((m) => m.descargado);
      if (primero) setModeloSeleccionado(primero.id);
    }
  }, []);

  const handleDescargarModelo = useCallback(
    async (id: string) => {
      descargandoModeloRef.current = id;
      setDescargandoModelo(id);
      setProgresoDescarga(0);
      setEstadoDescarga("conectando");
      setErrorDescarga(null);
      setBytesDescargados(0);
      setBytesTotal(0);
      try {
        await invoke("descargar_modelo", { id });
        setEstadoDescarga("completo");
        await cargarModelos();
      } catch (err) {
        const msg = typeof err === "string" ? err : JSON.stringify(err);
        console.error("Error descargando modelo:", err);
        setErrorDescarga(msg);
        setEstadoDescarga("");
      } finally {
        descargandoModeloRef.current = null;
        setDescargandoModelo(null);
      }
    },
    [cargarModelos],
  );

  const handleEliminarModelo = useCallback(
    async (id: string) => {
      try {
        await invoke("eliminar_modelo", { id });
      } catch (err) {
        console.error("Error eliminando modelo:", err);
      }
      // Si se borró el modelo seleccionado, limpiar la selección: evita el
      // botón "Transcribir" habilitado apuntando a un modelo que ya no existe
      if (modeloSeleccionadoRef.current === id) {
        setModeloSeleccionado("");
      }
      await cargarModelos();
    },
    [cargarModelos],
  );

  const handleTranscribir = useCallback(async () => {
    const modelo = modeloSeleccionadoRef.current;
    const ruta = videoPathRef.current;
    const tracksSel = tracksSeleccionadosRef.current;
    const gGlobal = glosarioGlobalRef.current;
    const gProyecto = glosarioRef.current;
    if (!modelo || !ruta) return;
    if (tracksSel.length === 0) {
      console.warn("No hay tracks seleccionados");
      return;
    }

    setTranscribiendo(true);
    setTranscripcionProgreso(null);
    setErrorTranscripcion(null);
    try {
      const glosarioCompleto =
        [gGlobal, gProyecto]
          .filter((g) => g.trim().length > 0)
          .flatMap((g) =>
            g
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
          .join(", ") || null;
      const segmentos = await invoke<SegmentoTranscrito[]>(
        "transcribir_video",
        {
          rutaVideo: ruta,
          modeloId: modelo,
          trackIndices: tracksSel,
          maxSpeakers: 10,
          glosario: glosarioCompleto,
          idioma: idiomaWhisperRef.current,
          modoMuestreo: modoMuestreoWhisperRef.current,
        },
      );
      // Se abrió otro video/proyecto mientras la transcripción corría: el
      // resultado es del video viejo, descartarlo (como en extraer_audio_stream)
      if (videoPathRef.current !== ruta) return;
      const nuevosCaptions: Caption[] = segmentos.map((s, i) => ({
        id: `cap-whisper-${Date.now()}-${i}`,
        inicio: s.inicio,
        fin: s.fin,
        texto: s.texto,
        hablante_id: s.speaker_id ?? null,
      }));
      pushHistorial();
      setCaptions(nuevosCaptions);
      captionsRef.current = nuevosCaptions;

      {
        const speakerIds = [
          ...new Set(
            segmentos
              .map((s) => s.speaker_id)
              .filter((id): id is string => id !== null),
          ),
        ];
        if (speakerIds.length > 0) {
          setHablantes((prev) => {
            const existentes = new Set(prev.map((h) => h.id));
            const nuevosHablantes = speakerIds
              .filter((id) => !existentes.has(id))
              .map((id, i) => ({
                id,
                nombre: `Hablante ${prev.length + i + 1}`,
                tecla: String(((prev.length + i) % 9) + 1),
                color: PALETA[(prev.length + i) % PALETA.length],
              }));
            if (nuevosHablantes.length === 0) return prev;
            const merged = [...prev, ...nuevosHablantes];
            hablantesRef.current = merged;
            return merged;
          });
        }
      }
    } catch (err) {
      console.error("Error transcribiendo:", err);
      setErrorTranscripcion(
        typeof err === "string" ? err : err instanceof Error ? err.message : String(err),
      );
    } finally {
      setTranscribiendo(false);
    }
  }, []);

  async function cargarTracks(ruta: string) {
    try {
      const lista = await invoke<TrackInfo[]>("listar_tracks_audio", { ruta });
      if (videoPathRef.current !== ruta) return; // se abrió otro video mientras tanto
      setTracks(lista);
      if (lista.length > 0) {
        // Seleccionar todas las pistas por defecto
        const todosLosIndices = lista.map((t) => t.index);
        setTracksSeleccionados(todosLosIndices);
        setTrackSeleccionado(lista[0].index); // para waveform y remuxeo
      } else {
        setTracksSeleccionados([]);
        setTrackSeleccionado(null);
      }
    } catch (err) {
      console.error("Error cargando tracks:", err);
    }
  }

  useEffect(() => {
    selectedCaptionIdsRef.current = selectedCaptionIds;
    volumenRef.current = volumen;
    windowSecondsRef.current = windowSeconds;
    captionsRef.current = captions;
    hablantesRef.current = hablantes;
    rutaProyectoRef.current = rutaProyecto;
    videoPathRef.current = videoPath;
    autoFollowingRef.current = autoFollowing;
    glosarioRef.current = glosario;
    glosarioGlobalRef.current = glosarioGlobal;
    tracksSeleccionadosRef.current = tracksSeleccionados;
    modeloSeleccionadoRef.current = modeloSeleccionado;
    idiomaWhisperRef.current = idiomaWhisper;
    modoMuestreoWhisperRef.current = modoMuestreoWhisper;
  });

  useEffect(() => {
    if (videoDuration > 0) {
      const maxStart = Math.max(0, videoDuration - windowSecondsRef.current);
      if (windowStartRef.current > maxStart) {
        windowStartRef.current = maxStart;
        windowTargetRef.current = maxStart;
        updateScrollbarThumb(maxStart, windowSecondsRef.current, videoDuration);
      }
    }
  }, [videoDuration, windowSeconds]);

  useEffect(() => {
    sortedByStartRef.current = [...captions].sort((a, b) => a.inicio - b.inicio);
  }, [captions]);

  useEffect(() => {
    const vol = volumen;
    if (vol.length === 0) {
      waveformPreRenderRef.current = null;
      return;
    }
    // Mientras llegan chunks, saltar el prerender: se regenera una sola vez
    // al terminar el análisis (volumen + analizando actualizan en el mismo batch).
    if (analizando) return;
    const PISO_DB = -50;
    const TECHO_DB = 0;
    const height = 90;
    const w = vol.length;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      waveformPreRenderRef.current = null;
      return;
    }

    const imageData = ctx.createImageData(w, height);
    const data = imageData.data;
    const barHeight = height * 0.85;

    for (let x = 0; x < w; x++) {
      const amp = vol[x];
      const db = 20 * Math.log10(Math.max(amp, 1e-5));
      const normalizado = Math.max(
        0,
        Math.min(1, (db - PISO_DB) / (TECHO_DB - PISO_DB)),
      );
      const barH = Math.max(1, normalizado * barHeight);
      const y0 = Math.floor((height - barH) / 2);
      const y1 = Math.ceil((height + barH) / 2);

      const r = Math.min(255, Math.floor(normalizado * 2 * 255));
      const g = Math.min(255, Math.floor((2 - normalizado * 2) * 255));
      const b = Math.max(0, Math.floor((1 - normalizado * 1.5) * 255));

      for (let y = y0; y < y1 && y < height; y++) {
        const idx = (y * w + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 255;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    waveformPreRenderRef.current = canvas;
  }, [volumen, analizando]);

  useEffect(() => {
    if (ignoreNextChangeRef.current) {
      ignoreNextChangeRef.current = false;
      return;
    }
    if (captions.length > 0 || hablantes.length > 0 || rutaProyecto.length > 0) {
      isDirtyRef.current = true;
      setHayCambios(true);
    }
  }, [captions, hablantes, rutaProyecto]);

  // Nuevo ref al inicio del componente
  const waveformCacheRef = useRef<Map<string, number[]>>(new Map());

  // Cache en memoria con tope: evita que una sesión larga acumule waveforms
  // de decenas de videos sin límite.
  function cachearVolumen(clave: string, datos: number[]) {
    const cache = waveformCacheRef.current;
    if (cache.has(clave)) cache.delete(clave);
    cache.set(clave, datos);
    while (cache.size > 8) {
      const primera = cache.keys().next().value;
      if (primera === undefined) break;
      cache.delete(primera);
    }
  }

  async function analizarVolumenDe(ruta: string, track_index?: number) {
    if (track_index === undefined) {
      console.warn("analizarVolumenDe llamado sin track_index");
      return;
    }

    const claveCache = `${ruta}::${track_index}`;
    const miRequestId = ++analisisVolumenRequestRef.current;

    const cached = waveformCacheRef.current.get(claveCache);
    if (cached) {
      setVolumen(cached);
      setAnalizando(false);
      return;
    }

    try {
      const tieneCache = await invoke<boolean>("existe_cache_volumen", {
        rutaVideo: ruta,
        trackIndex: track_index,
      });
      if (analisisVolumenRequestRef.current !== miRequestId) return; // respuesta obsoleta, descartar

      if (tieneCache) {
        const datos = await invoke<number[]>("cargar_cache_volumen", {
          rutaVideo: ruta,
          trackIndex: track_index,
        });
        if (analisisVolumenRequestRef.current !== miRequestId) return;
        cachearVolumen(claveCache, datos);
        setVolumen(datos);
        setAnalizando(false);
        return;
      }
    } catch (err) {
      console.warn("Error al leer caché de disco:", err);
    }

    setAnalizando(true);
    setVolumen([]);

    const unlistenChunk = await listen<[number | null, number[]]>(
      "volumen_chunk",
      (event) => {
        const [chunkTrack, datos] = event.payload;
        if (chunkTrack !== track_index) return; // descarta chunks de análisis anteriores
        if (analisisVolumenRequestRef.current !== miRequestId) {
          unlistenChunk();
          return;
        }
        setVolumen((prev) => [...prev, ...datos]);
      },
    );

    try {
      const resultado = await invoke<number[]>("analizar_volumen", {
        ruta,
        trackIndex: track_index,
      });
      unlistenChunk();
      if (analisisVolumenRequestRef.current !== miRequestId) return;
      cachearVolumen(claveCache, resultado);
      setVolumen(resultado);
    } catch (err) {
      unlistenChunk();
      console.error("Error analizando volumen:", err);
    } finally {
      if (analisisVolumenRequestRef.current === miRequestId)
        setAnalizando(false);
    }
  }

  function cargarVideoDesdeRuta(path: string) {
    console.log(`[DEBUG APP] cargarVideoDesdeRuta -> path=${path}`);
    setVideoPath(path);
    setVideoSrc(convertFileSrc(path));
    setVideoNoEncontrado(false);
    windowStartRef.current = 0;
    windowTargetRef.current = 0;
    updateScrollbarThumb(0, windowSecondsRef.current, 0);
    setTracks([]);
    setTrackSeleccionado(null);
    setAudioSrc(null);
    // Descartar análisis/volumen/duración del video anterior (un análisis en
    // vuelo del video viejo ya no puede pintar su waveform acá)
    analisisVolumenRequestRef.current++;
    setVolumen([]);
    setAnalizando(false);
    setVideoDuration(0);
    waveformCacheRef.current.clear();
    cargarTracks(path);
  }

  async function cargarSrtDesdeRuta(path: string) {
    try {
      const contenido = await invoke<string>("leer_archivo_texto", {
        ruta: path,
      });
      const parsed = parseSrt(contenido);
      ignoreNextChangeRef.current = true;
      isDirtyRef.current = false;
      setHayCambios(false);
      setCaptions(parsed);
    } catch (err) {
      console.error("Error cargando SRT:", err);
    }
  }

  async function handleAbrirVideo() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Video", extensions: ["mp4", "mov", "avi", "mkv"] }],
      });
      if (path) {
        console.log(`[DEBUG handleAbrirVideo] Video seleccionado: ${path}`);
        cargarVideoDesdeRuta(path);
      }
    } catch (err) {
      console.error("[ERROR handleAbrirVideo] Error abriendo diálogo:", err);
      console.log("[DEBUG] No se pudo abrir el diálogo de video");
    }
  }

  async function handleAbrirSrt() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Subtítulos", extensions: ["srt"] }],
      });
      if (path) await cargarSrtDesdeRuta(path);
    } catch (err) {
      console.error("Error abriendo diálogo SRT:", err);
    }
  }

  async function guardarProyectoEnRuta(path: string) {
    console.log("Guardando en:", path);
    console.log("videoPathRef:", videoPathRef.current);
    console.log("captionsRef:", captionsRef.current.length, "captions");
    console.log("hablantesRef:", hablantesRef.current.length, "hablantes");

    const proyecto: Proyecto = {
      ruta_video: videoPathRef.current,
      hablantes: hablantesRef.current,
      captions: captionsRef.current,
    };

    try {
      await invoke("guardar_proyecto", { ruta: path, proyecto });
      if (rutaProyectoRef.current !== path) {
        ignoreNextChangeRef.current = true;
      }
      isDirtyRef.current = false;
      setHayCambios(false);
      setRutaProyecto(path);
      rutaProyectoRef.current = path;
      console.log("Guardado exitoso");
    } catch (err) {
      console.error("ERROR al guardar:", err);
    }
  }

  async function handleGuardarComo() {
    try {
      const path = await save({
        filters: [{ name: "Proyecto ColorDubber", extensions: ["json"] }],
      });
      if (!path) return;
      await guardarProyectoEnRuta(path);
    } catch (err) {
      console.error("Error abriendo diálogo de guardado:", err);
    }
  }

  async function handleGuardar() {
    if (rutaProyectoRef.current) {
      await guardarProyectoEnRuta(rutaProyectoRef.current);
    } else {
      await handleGuardarComo();
    }
  }

  async function handleCargarProyecto() {
    if (isDirtyRef.current) {
      const ok = await ask(
        "Tienes cambios sin guardar. ¿Abrir otro proyecto?",
        { title: "Cambios sin guardar", kind: "warning" },
      );
      if (!ok) return;
    }
    const path = await open({
      multiple: false,
      filters: [{ name: "Proyecto ColorDubber", extensions: ["json"] }],
    });
    if (!path) return;

    try {
      const proyecto: Proyecto = await invoke("cargar_proyecto", {
        ruta: path,
      });
      ignoreNextChangeRef.current = true;
      isDirtyRef.current = false;
      setHayCambios(false);
      setRutaProyecto(path);
      setCaptions(proyecto.captions || []);
      setHablantes(proyecto.hablantes || []);
      setTracks([]);
      setTrackSeleccionado(null);
      setAudioSrc(null);
      setSelectedCaptionIds([]);
      // Descartar waveform/duración del proyecto anterior
      analisisVolumenRequestRef.current++;
      setVolumen([]);
      setAnalizando(false);
      setVideoDuration(0);
      waveformCacheRef.current.clear();

      const existe: boolean = await invoke("existe_archivo", {
        ruta: proyecto.ruta_video,
      });
      if (existe) {
        cargarVideoDesdeRuta(proyecto.ruta_video);
      } else {
        setRutaFaltante(proyecto.ruta_video);
        setVideoNoEncontrado(true);
      }
    } catch (err) {
      console.error("Error cargando proyecto:", err);
    }
  }

  async function handleNuevoProyecto() {
    if (isDirtyRef.current) {
      const ok = await ask("Tienes cambios sin guardar. ¿Nuevo proyecto?", {
        title: "Cambios sin guardar",
        kind: "warning",
      });
      if (!ok) return;
    }
    ignoreNextChangeRef.current = true;
    isDirtyRef.current = false;
    setHayCambios(false);
    setVideoSrc("");
    setVideoPath("");
    setRutaProyecto("");
    setVideoNoEncontrado(false);
    setVolumen([]);
    setCaptions([]);
    setHablantes([]);
    setTracks([]);
    setTrackSeleccionado(null);
    setAudioSrc(null);
    setSelectedCaptionIds([]);
    // Descartar análisis en vuelo, waveform y duración del proyecto anterior
    analisisVolumenRequestRef.current++;
    setAnalizando(false);
    setVideoDuration(0);
    waveformCacheRef.current.clear();
    windowStartRef.current = 0;
    windowTargetRef.current = 0;
    updateScrollbarThumb(0, windowSecondsRef.current, 0);
  }
  async function handleExportarSrtPorHablante() {
    if (captionsRef.current.length === 0) {
      setExportMensaje("No hay subtítulos para exportar.");
      setTimeout(() => setExportMensaje(""), 4000);
      return;
    }

    try {
      const carpeta = await open({ directory: true });
      if (!carpeta) return;

      const sinAsignar = captionsRef.current.filter(
        (c) => !c.hablante_id,
      ).length;
      let archivosCreados = 0;

      for (const h of hablantesRef.current) {
        const propios = captionsRef.current
          .filter((c) => c.hablante_id === h.id)
          .sort((a, b) => a.inicio - b.inicio);
        if (propios.length === 0) continue;

        const contenido = buildSrt(propios);
        const nombreArchivo = `${(h.nombre || h.tecla || h.id).replace(/[\\/:*?"<>|]/g, "_")}.srt`;
        await invoke("escribir_archivo_en_carpeta", {
          carpeta,
          nombreArchivo,
          contenido,
        });
        archivosCreados++;
      }

      const solapes = BuildOverlapReport(
        captionsRef.current,
        hablantesRef.current,
      );
      if (solapes.length > 0) {
        await invoke("escribir_archivo_en_carpeta", {
          carpeta,
          nombreArchivo: "solapes.txt",
          contenido: FormatOverlapReport(solapes),
        });
      }

      if (archivosCreados === 0) {
        setExportMensaje("Ningún subtítulo tiene hablante asignado todavía.");
      } else if (sinAsignar > 0) {
        setExportMensaje(
          `${archivosCreados} archivo(s) exportados. ${sinAsignar} subtítulo(s) sin hablante quedaron afuera.` +
            (solapes.length > 0
              ? ` — ${solapes.length} solape(s), revisa solapes.txt.`
              : ""),
        );
      } else {
        setExportMensaje(
          `${archivosCreados} archivo(s) exportados correctamente.` +
            (solapes.length > 0
              ? ` — ${solapes.length} solape(s), revisa solapes.txt.`
              : ""),
        );
      }
      setTimeout(() => setExportMensaje(""), 5000);
    } catch (err) {
      console.error("Error exportando SRT por hablante:", err);
    }
  }

  async function handleExportarJsonCombinado() {
    if (captionsRef.current.length === 0) {
      setExportMensaje("No hay subtítulos para exportar.");
      setTimeout(() => setExportMensaje(""), 4000);
      return;
    }

    try {
      const path = await save({
        filters: [{ name: "JSON combinado", extensions: ["json"] }],
        defaultPath: "subtitulos_combinado.json",
      });
      if (!path) return;

      const data = captionsRef.current.map((c) => {
        const sp = hablantesRef.current.find((h) => h.id === c.hablante_id);
        return {
          inicio: formatSrtTimestamp(c.inicio),
          fin: formatSrtTimestamp(c.fin),
          texto: c.texto,
          hablante: sp ? sp.nombre || sp.tecla : null,
        };
      });

      await invoke("escribir_archivo_texto", {
        ruta: path,
        contenido: JSON.stringify(data, null, 2),
      });
      setExportMensaje("JSON combinado exportado.");
      setTimeout(() => setExportMensaje(""), 4000);
    } catch (err) {
      console.error("Error exportando JSON:", err);
    }
  }

  const togglePanelHablantes = useCallback(
    () => setPanelHablantesAbierto((v) => !v),
    [],
  );
  const togglePanelModelos = useCallback(
    () => setPanelModelosAbierto((v) => !v),
    [],
  );
  const toggleTrack = useCallback((i: number) => {
    setTracksSeleccionados((prev) =>
      prev.includes(i) ? prev.filter((j) => j !== i) : [...prev, i],
    );
  }, []);

  useEffect(() => {
    const unlistenAbrir = listen("abrir_proyecto", () =>
      handleCargarProyecto(),
    );
    const unlistenGuardar = listen("guardar_proyecto", () => handleGuardar());
    const unlistenGuardarComo = listen("guardar_como", () =>
      handleGuardarComo(),
    );
    const unlistenNuevo = listen("nuevo_proyecto", () => handleNuevoProyecto());
    const unlistenAbrirVideo = listen("abrir_video", () => handleAbrirVideo());
    const unlistenCargarSrt = listen("cargar_srt", () => handleAbrirSrt());
    const unlistenExportarSrt = listen("exportar_srt_hablantes", () =>
      handleExportarSrtPorHablante(),
    );
    const unlistenExportarJson = listen("exportar_json", () =>
      handleExportarJsonCombinado(),
    );
    const unlistenTranscripcion = listen<TranscripcionProgreso>(
      "transcripcion_progreso",
      (e) => setTranscripcionProgreso(e.payload),
    );

    return () => {
      unlistenAbrir.then((f) => f());
      unlistenGuardar.then((f) => f());
      unlistenGuardarComo.then((f) => f());
      unlistenNuevo.then((f) => f());
      unlistenAbrirVideo.then((f) => f());
      unlistenCargarSrt.then((f) => f());
      unlistenExportarSrt.then((f) => f());
      unlistenExportarJson.then((f) => f());
      unlistenTranscripcion.then((f) => f());
    };
    // Los handlers leen refs (videoPathRef, captionsRef, etc.), nunca estado stale:
    // las deps vacías evitan re-suscripciones en cada cambio de captions/hablantes.
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      const onLoadedMeta = () => setVideoDuration(video.duration);
      video.addEventListener("loadedmetadata", onLoadedMeta);
      return () => video.removeEventListener("loadedmetadata", onLoadedMeta);
    }
  }, [videoSrc]);

  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio) return;

    const onPlay = () => {
      setReproduciendo(true);
      audio.play().catch(() => {});
    };
    const onPause = () => {
      setReproduciendo(false);
      audio.pause();
    };
    const onSeeked = () => {
      if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
        if (Math.abs(audio.currentTime - video.currentTime) > 0.5) {
          audio.currentTime = video.currentTime;
        }
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
    };
  }, [videoSrc, audioSrc]);
  useEffect(() => {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video || !audio || !audioSrc) return;

    // El sync escucha "canplay" SIN once: si el audio.play() se intentó antes
    // de que el elemento estuviera listo (NotSupportedError silenciado por el
    // catch), el siguiente canplay reintenta. Un sync con { once: true } se
    // consume mientras el video está pausado y deja el audio mudo para siempre.
    // El currentTime solo se ajusta si el desfase supera el umbral: resetearlo
    // a cada canplay/seek del video (stalls de decodificación, seeks) hace que
    // el audio tartamudee como un juego a bajos fps.
    const UMBRAL_SYNC = 0.5;
    const sync = () => {
      if (Math.abs(audio.currentTime - video.currentTime) > UMBRAL_SYNC) {
        audio.currentTime = video.currentTime;
      }
      if (!video.paused) {
        audio.play().catch(() => {});
      }
    };

    const onAudioError = () => {
      console.error(
        "[AUDIO] error del elemento audio:",
        audio.error?.code,
        audio.error?.message,
        "src:",
        audio.src,
      );
      // Reintentar la carga en vez de desmutear el video: desmutear dejaría
      // dos fuentes sonando a la vez (combate de fase / tartamudeo).
      audio.load();
    };

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      sync();
    }
    audio.addEventListener("canplay", sync);
    audio.addEventListener("error", onAudioError);
    return () => {
      audio.removeEventListener("canplay", sync);
      audio.removeEventListener("error", onAudioError);
    };
  }, [audioSrc]);

  useEffect(() => {
    cargarModelos();
    invoke<string>("cargar_glosario_global")
      .then(setGlosarioGlobal)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    el.addEventListener("wheel", handleWheelTimeline, { passive: false });
    return () => el.removeEventListener("wheel", handleWheelTimeline);
  }, []);

  const guardarGlosarioGlobal = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(() => {
    if (guardarGlosarioGlobal.current)
      clearTimeout(guardarGlosarioGlobal.current);
    guardarGlosarioGlobal.current = setTimeout(() => {
      invoke("guardar_glosario_global", { texto: glosarioGlobal });
    }, 500);
    return () => {
      if (guardarGlosarioGlobal.current)
        clearTimeout(guardarGlosarioGlobal.current);
    };
  }, [glosarioGlobal]);

  useEffect(() => {
    if (
      videoPathRef.current &&
      trackSeleccionado !== null &&
      tracks.length > 0
    ) {
      console.log(`[TRACK] Cambiando a track ${trackSeleccionado}`);

      analizarVolumenDe(videoPathRef.current, trackSeleccionado);

      const rutaAlPedir = videoPathRef.current;
      setExtrayendo(true);
      (async () => {
        try {
          const rutaAudio = await invoke<string>("extraer_audio_stream", {
            rutaVideo: rutaAlPedir,
            audioTrackIndex: trackSeleccionado,
          });

          if (videoPathRef.current !== rutaAlPedir) return;

          setAudioSrc(convertFileSrc(rutaAudio));
        } catch (err) {
          console.error("Error extrayendo audio:", err);
        } finally {
          if (videoPathRef.current === rutaAlPedir) setExtrayendo(false);
        }
      })();
    }
  }, [trackSeleccionado, videoPath, tracks]);

  useEffect(() => {
    const unlisten = listen<ModeloDescargaEvent>(
      "modelo_descarga_progreso",
      (event) => {
      // Usamos el ref para evitar stale closure: el listener se monta una sola vez
      // y siempre lee el valor actualizado sin necesidad de re-suscribirse.
      if (
        descargandoModeloRef.current &&
        event.payload.id === descargandoModeloRef.current
      ) {
        setProgresoDescarga(event.payload.progreso);
        if (event.payload.bytes_descargados !== undefined)
          setBytesDescargados(event.payload.bytes_descargados);
        if (event.payload.bytes_total !== undefined)
          setBytesTotal(event.payload.bytes_total);
        if (event.payload.estado) setEstadoDescarga(event.payload.estado);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Helper del body drag: aplica el transform de los clips arrastrados según
  // el TIEMPO bajo el cursor (ws + x→tiempo), no según píxeles acumulados,
  // para que funcione también durante el auto-pan de los bordes.
  function aplicarTransformBodyDrag(clientX: number, clientY: number, ctrlKey: boolean) {
    const bd = bodyDragRef.current;
    const area = trackAreaRef.current;
    if (!bd || !area) return;
    const areaWidth = Math.max(1, area.clientWidth - TRACK_LABEL_W);
    const wSec = windowSecondsRef.current;
    const ws = windowStartRef.current;
    const rect = area.getBoundingClientRect();
    const lead = captionsRef.current.find((c) => c.id === bd.ids[0]);
    if (!lead) return;
    let leadNuevo = ws + ((clientX - rect.left - TRACK_LABEL_W) / areaWidth) * wSec;
    if (!ctrlKey) {
      const snap = findSnapTime(leadNuevo, bd.ids, captionsRef.current);
      if (snap !== null) leadNuevo = snap;
    }
    let deltaT = leadNuevo - lead.inicio;
    if (deltaT < -lead.inicio) deltaT = -lead.inicio;
    bd.deltaT = deltaT;
    if (Math.abs(deltaT) > 0.002) bd.moved = true;
    // Fila destino (para el salto vertical y la reasignación al soltar)
    const fila = Math.floor(
      (clientY - rect.top + area.scrollTop) / TRACK_H,
    );
    if (fila >= 0 && fila <= hablantesRef.current.length) {
      bd.targetFila = fila;
    }
    // Mover los clips con transform (sin re-render de React)
    const pxX = (deltaT / wSec) * areaWidth;
    for (const [id, el] of bd.els) {
      const fila0 = bd.filaOrigen.get(id) ?? 0;
      const py = (bd.targetFila - fila0) * TRACK_H;
      el.style.transform = `translate(${pxX}px, ${py}px)`;
      el.style.zIndex = "30";
    }
    // Highlight del track destino
    const tracks = Array.from(area.querySelectorAll<HTMLElement>(".track"));
    tracks.forEach((t, i) => {
      t.classList.toggle("dropTarget", i === bd.targetFila);
    });
  }

  useEffect(() => {
    let rafId: number;
    let lastTick = performance.now();

    function tick() {
      const dt = Math.min((performance.now() - lastTick) / 1000, 0.05);
      lastTick = performance.now();
      const video = videoRef.current;
      let currentTime = 0;

      if (video) {
        currentTime = video.currentTime;

        const maxStart =
          video.duration > 0
            ? Math.max(0, video.duration - windowSecondsRef.current)
            : 0;

        if (isDraggingPlayheadRef.current || bodyDragRef.current) {
          const vel = dragScrollVelocityRef.current;
          if (vel !== 0) {
            const nuevo = Math.max(0, windowStartRef.current + vel * dt);
            windowStartRef.current = Math.min(nuevo, maxStart);
            windowTargetRef.current = windowStartRef.current;
            updateScrollbarThumb(windowStartRef.current, windowSecondsRef.current, video.duration);
            // Re-render por frame: todos los clips siguen al canvas durante el pan.
            setWindowStart(windowStartRef.current);
            // El pan cambia el tiempo bajo el cursor: re-aplicar el transform
            // para que los clips arrastrados sigan pegados al ratón.
            const bd = bodyDragRef.current;
            if (bd) {
              aplicarTransformBodyDrag(bd.lastX, bd.lastY, bd.ctrlDown);
            }
          } else {
            windowTargetRef.current = windowStartRef.current;
          }
        } else if (
          autoFollowingRef.current &&
          !isScrollingManuallyRef.current
        ) {
          const wSec = windowSecondsRef.current;
          const ws = windowStartRef.current;

          if (currentTime < ws || currentTime > ws + wSec) {
            windowTargetRef.current = Math.max(
              0,
              Math.min(maxStart, currentTime - wSec * NEW_MARGIN),
            );
          } else if (currentTime > ws + wSec * EDGE_TRIGGER) {
            windowTargetRef.current = Math.max(
              0,
              Math.min(maxStart, currentTime - wSec * NEW_MARGIN),
            );
          }
        }

        const diff = windowTargetRef.current - windowStartRef.current;
        if (Math.abs(diff) > 0.002) {
          windowStartRef.current += diff * LERP_FACTOR;
          windowStartRef.current = Math.max(
            0,
            Math.min(maxStart, windowStartRef.current),
          );
          updateScrollbarThumb(windowStartRef.current, windowSecondsRef.current, video.duration);
          // Re-render por frame durante el pan/follow (incluso con video
          // pausado, donde el playhead no tickea): los clips siguen al canvas.
          setWindowStart(windowStartRef.current);
        }

        playheadFrameSkipRef.current++;
        if (
          isDraggingPlayheadRef.current ||
          playheadFrameSkipRef.current % 6 === 0
        ) {
          setPlayheadTime(currentTime);
        }
      }

      drawCanvasFrame(currentTime);
      rafId = requestAnimationFrame(tick);
    }

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Patrón #1: sincroniza el state con el ref para que los clips del trackArea
  // sigan el pan/follow/seek (el ref cambia en el rAF, no en un re-render).
  useEffect(() => {
    setWindowStart(windowStartRef.current);
  });

  function togglePlay() {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
      audio?.play().catch(() => {});
      setAutoFollowing(true);
      isScrollingManuallyRef.current = false;
    } else {
      video.pause();
      audio?.pause();
    }
  }

  function saltar(delta: number) {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;
    const newTime = Math.max(
      0,
      Math.min(video.duration || Infinity, video.currentTime + delta),
    );
    video.currentTime = newTime;
    if (audio) audio.currentTime = newTime;
    isScrollingManuallyRef.current = false;
  }

  function saltarCaption(direccion: 1 | -1) {
    const video = videoRef.current;
    const audio = audioRef.current;
    if (!video) return;
    const caps = sortedByStartRef.current;
    if (caps.length === 0) return;
    const t = video.currentTime;

    let newTime: number;
    if (direccion === 1) {
      let lo = 0;
      let hi = caps.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (caps[mid].inicio > t + 0.05) hi = mid;
        else lo = mid + 1;
      }
      newTime = lo < caps.length ? caps[lo].inicio + 0.01 : t;
    } else {
      let lo = 0;
      let hi = caps.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (caps[mid].inicio < t - 0.05) lo = mid + 1;
        else hi = mid;
      }
      // Si el playhead está dentro o después del inicio del candidato, ese no
      // es el "anterior": retroceder uno más (Alt+← dentro de un caption va al
      // caption anterior, no reinicia el actual).
      if (lo > 0 && t >= caps[lo - 1].inicio) lo -= 1;
      newTime = lo > 0 ? caps[lo - 1].inicio + 0.01 : caps[0].inicio + 0.01;
    }
    video.currentTime = newTime;
    if (audio) audio.currentTime = newTime;
    isScrollingManuallyRef.current = false;
  }

  function asignarHablante(hablanteId: string) {
    const sel = selectedCaptionIdsRef.current;
    if (sel.length > 0) {
      pushHistorial();
      setCaptions((prev) => {
        const copy = prev.map((c) =>
          sel.includes(c.id) ? { ...c, hablante_id: hablanteId } : c,
        );
        captionsRef.current = copy;
        return copy;
      });
      return;
    }
    const idx = currentCaptionIdxRef.current;
    if (idx === -1) return;
    pushHistorial();

    setCaptions((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], hablante_id: hablanteId };
      captionsRef.current = copy;
      return copy;
    });
  }

  function actualizarTextoCaption(id: string, nuevoTexto: string) {
    setCaptions((prev) => {
      const copy = prev.map((c) =>
        c.id === id ? { ...c, texto: nuevoTexto } : c,
      );
      captionsRef.current = copy;
      return copy;
    });
  }
  function agregarFragmento() {
    pushHistorial();
    const video = videoRef.current;
    const inicio = video ? video.currentTime : 0;
    const duracionDefault = 1.5;
    const nuevo: Caption = {
      id: `cap-frag-${Date.now()}`,
      inicio,
      fin: inicio + duracionDefault,
      texto: "",
      hablante_id: null,
    };
    setCaptions((prev) => {
      const copy = [...prev, nuevo].sort((a, b) => a.inicio - b.inicio);
      captionsRef.current = copy;
      return copy;
    });
    setSelectedCaptionIds([nuevo.id]);
    // El focus disparará handleEditorFocus; ya se pusheó el snapshot pre-add
    skipEditorHistoryRef.current = true;
    setTimeout(() => textEditorRef.current?.focus(), 30);
  }

  const eliminarCaption = useCallback((id: string) => {
    pushHistorial();
    setCaptions((prev) => {
      const copy = prev.filter((c) => c.id !== id);
      captionsRef.current = copy;
      return copy;
    });
  }, [pushHistorial, setCaptions]);

  const eliminarSeleccion = useCallback(() => {
    const sel = selectedCaptionIdsRef.current;
    if (sel.length === 0) return;
    pushHistorial();
    setCaptions((prev) => {
      const copy = prev.filter((c) => !sel.includes(c.id));
      captionsRef.current = copy;
      return copy;
    });
    setSelectedCaptionIds([]);
  }, [pushHistorial, setCaptions]);

  // ==== Selección múltiple ====
  const seleccionSola = useCallback((id: string) => {
    setSelectedCaptionIds([id]);
  }, []);

  const toggleSeleccion = useCallback((id: string) => {
    setSelectedCaptionIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  // Shift+click: rango desde el último seleccionado hasta el clickeado.
  // porTiempo=true usa el orden temporal (track); false usa el orden del array
  // (lista derecha).
  const seleccionRango = useCallback((id: string, porTiempo: boolean) => {
    setSelectedCaptionIds((prev) => {
      const anchor = prev[prev.length - 1];
      const caps = porTiempo ? sortedByStartRef.current : captionsRef.current;
      const iA = anchor ? caps.findIndex((c) => c.id === anchor) : -1;
      const iB = caps.findIndex((c) => c.id === id);
      if (iA === -1 || iB === -1) return [id];
      const [lo, hi] = iA < iB ? [iA, iB] : [iB, iA];
      return caps.slice(lo, hi + 1).map((c) => c.id);
    });
  }, []);

  const handleSelectCaption = useCallback(
    (id: string, shift: boolean, ctrl: boolean) => {
      if (shift) {
        seleccionRango(id, false);
        return;
      }
      if (ctrl) {
        toggleSeleccion(id);
        return;
      }
      seleccionSola(id);
      const cap = captionsRef.current.find((c) => c.id === id);
      const video = videoRef.current;
      const audio = audioRef.current;
      if (cap && video) {
        video.currentTime = cap.inicio;
        if (audio) audio.currentTime = cap.inicio;
      }
    },
    [seleccionRango, toggleSeleccion, seleccionSola],
  );

  // Mueve una selección de captions un deltaT (manteniendo cada duración).
  // pushHistorial UNA vez: Ctrl+Z deshace todo el bloque.
  const moverCaptions = useCallback(
    (ids: string[], deltaT: number, nuevoHablanteId?: string | null) => {
      if (ids.length === 0) return;
      if (deltaT === 0 && nuevoHablanteId === undefined) return;
      pushHistorial();
      setCaptions((prev) => {
        const copy = prev.map((c) => {
          if (!ids.includes(c.id)) return c;
          const dur = c.fin - c.inicio;
          const nuevoInicio = Math.max(0, c.inicio + deltaT);
          const updated: Caption = {
            ...c,
            inicio: nuevoInicio,
            fin: nuevoInicio + dur,
          };
          if (nuevoHablanteId !== undefined) {
            updated.hablante_id = nuevoHablanteId;
          }
          return updated;
        });
        captionsRef.current = copy;
        return copy;
      });
    },
    [pushHistorial, setCaptions],
  );

  function dividirCaptionEnPlayhead() {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    const idx = currentCaptionIdxRef.current;
    const cap = captionsRef.current[idx];
    if (!cap || t <= cap.inicio || t >= cap.fin) return;
    pushHistorial();
    const izquierda: Caption = {
      ...cap,
      id: `cap-cut-${Date.now()}-l`,
      fin: t,
    };
    const derecha: Caption = {
      ...cap,
      id: `cap-cut-${Date.now()}-r`,
      inicio: t,
    };
    setCaptions((prev) => {
      const copy = prev
        .filter((c) => c.id !== cap.id)
        .concat([izquierda, derecha])
        .sort((a, b) => a.inicio - b.inicio);
      captionsRef.current = copy;
      return copy;
    });
    setSelectedCaptionIds([derecha.id]);
  }

  function actualizarTiempoCaption(
    id: string,
    campo: "inicio" | "fin",
    nuevoValor: number,
  ) {
    pushHistorial();
    setCaptions((prev) => {
      const copy = prev.map((c) => {
        if (c.id === id) {
          const updated = { ...c, [campo]: Math.max(0, nuevoValor) };
          // Asegurar que inicio < fin
          if (campo === "inicio" && updated.inicio >= updated.fin) {
            updated.inicio = updated.fin - 0.1;
          }
          if (campo === "fin" && updated.fin <= updated.inicio) {
            updated.fin = updated.inicio + 0.1;
          }
          return updated;
        }
        return c;
      });
      captionsRef.current = copy;
      return copy;
    });
  }

  function handleEditorFocus() {
    if (skipEditorHistoryRef.current) {
      // Focus automático tras "Nuevo fragmento": el snapshot ya se pusheó
      // antes de agregar; no crear un paso de undo duplicado.
      skipEditorHistoryRef.current = false;
    } else if (
      editorPushedCaptionsRef.current !== captionsRef.current ||
      editorPushedHablantesRef.current !== hablantesRef.current
    ) {
      // Snapshot pre-edición (una sola vez por sesión de focus; un segundo
      // focus sin cambios no crea pasos de undo vacíos).
      pushHistorial();
      editorPushedCaptionsRef.current = captionsRef.current;
      editorPushedHablantesRef.current = hablantesRef.current;
    }
    const video = videoRef.current;
    if (!video) return;
    wasPlayingBeforeEditRef.current = !video.paused;
    if (!video.paused) video.pause();
  }

  function handleEditorBlur() {
    const video = videoRef.current;
    if (!video) return;
    if (wasPlayingBeforeEditRef.current) {
      video.play().catch(() => {});
    }
  }

  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      (e.target as HTMLTextAreaElement).blur();
    }
  }

  function handleTimeInputFocus() {
    setEditandoTiempo(true);
    setTimeInputValue(formatTime(playheadTime));
  }

  function handleTimeInputBlur() {
    setEditandoTiempo(false);
  }

  function handleTimeInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const secs = parseTimeInput(timeInputValue);
    const video = videoRef.current;
    if (secs !== null && video) {
      // Guardar estado de reproducción
      wasPlayingBeforeSeekRef.current = !video.paused;
      // Pausar si estaba reproduciendo
      if (!video.paused) {
        video.pause();
      }
      video.currentTime = Math.max(
        0,
        Math.min(video.duration || Infinity, secs),
      );
      // Restaurar reproducción
      if (wasPlayingBeforeSeekRef.current) {
        setTimeout(() => {
          video.play().catch(() => {});
        }, 50);
      }
    }
    (e.target as HTMLInputElement).blur();
  }
  // Manejar click en el timeline - ir al tiempo exacto donde se clickea
  function handleClickTimeline(e: React.MouseEvent) {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    if (justFinishedBodyDragRef.current) {
      justFinishedBodyDragRef.current = false;
      return;
    }
    // Click sin arrastre en el borde de un caption: el mousedown/mouseup del
    // edge ya manejó todo; el seek del click pausaría el video de nuevo.
    if (justFinishedEdgeDragRef.current) {
      justFinishedEdgeDragRef.current = false;
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - TRACK_LABEL_W;
    const t = windowStartRef.current + (x / Math.max(1, rect.width - TRACK_LABEL_W)) * windowSecondsRef.current;

    // El mousedown ya pausó el video (y el mouseup ya restauró la reproducción
    // si correspondía): aquí solo se busca, sin tocar el estado de reproducción.
    const clampedTime = Math.max(0, Math.min(video.duration || Infinity, t));
    video.currentTime = clampedTime;
    isScrollingManuallyRef.current = false;
  }
  // Manejar eventos del mouse para el playhead y bordes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function getTimeFromMouse(e: MouseEvent): number {
      const rect = canvas!.getBoundingClientRect();

      const x = e.clientX - rect.left - TRACK_LABEL_W;
      const clampedX = Math.max(
        0,
        Math.min(rect.width - TRACK_LABEL_W, x),
      );
      return (
        windowStartRef.current +
        (clampedX / Math.max(1, rect.width - TRACK_LABEL_W)) *
          windowSecondsRef.current
      );
    }

    function onMouseDown(e: MouseEvent) {
      // El mousedown en el canvas (waveform) siempre arrastra el playhead;
      // los bordes de caption los manejan los clips del trackArea (HTML).
      isDraggingPlayheadRef.current = true;
      const video = videoRef.current;
      if (video) {
        // Guardar estado de reproducción
        wasPlayingBeforeSeekRef.current = !video.paused;
        // Pausar si estaba reproduciendo
        if (!video.paused) {
          video.pause();
        }
        const rect = canvas!.getBoundingClientRect();
        const x = e.clientX - rect.left - TRACK_LABEL_W;
        const wSec = windowSecondsRef.current;
        const ws = windowStartRef.current;
        const rawTime = ws + (x / Math.max(1, rect.width - TRACK_LABEL_W)) * wSec;
        video.currentTime = Math.max(0, rawTime);
      }
    }

    function updateClipDiv(captionId: string) {
      const area = trackAreaRef.current;
      if (!area) return;
      const el = area.querySelector<HTMLElement>(
        `[data-caption-id="${captionId}"]`,
      );
      const cap = captionsRef.current.find((c) => c.id === captionId);
      if (!el || !cap) return;
      const ws = windowStartRef.current;
      const wSec = windowSecondsRef.current;
      const drag = isDraggingCaptionEdgeRef.current;
      let s = cap.inicio;
      let e = cap.fin;
      if (drag && drag.captionId === captionId) {
        const t = dragCurrentTimeRef.current;
        if (drag.edge === "start") s = t;
        else e = t;
      }
      el.style.left = `${Math.max(0, ((s - ws) / wSec) * 100)}%`;
      el.style.width = `${Math.max(0.3, ((e - s) / wSec) * 100)}%`;
    }

    function onMouseMove(e: MouseEvent) {
      // Drag del handle inferior: expandir/contraer la vista de carriles
      if (trackHandleDraggingRef.current) {
        const area = trackAreaRef.current;
        const handle = trackHandleRef.current;
        if (area && handle) {
          const wrap = handle.parentElement;
          if (wrap) {
            const wrapRect = wrap.getBoundingClientRect();
            const h = e.clientY - wrapRect.top - WAVEFORM_H - TRACK_HANDLE_H;
            area.style.maxHeight = `${Math.min(
              TRACK_MAX * TRACK_H,
              Math.max(2 * TRACK_H, h),
            )}px`;
          }
        }
        return;
      }

      if (marqueeStateRef.current?.active) {
        const ms = marqueeStateRef.current;
        const ov = marqueeOverlayRef.current;
        if (ov) {
          const x = Math.min(ms.startX, e.clientX);
          const y = Math.min(ms.startY, e.clientY);
          ov.style.left = `${x}px`;
          ov.style.top = `${y}px`;
          ov.style.width = `${Math.abs(e.clientX - ms.startX)}px`;
          ov.style.height = `${Math.abs(e.clientY - ms.startY)}px`;
        }
        return;
      }

      if (bodyDragRef.current) {
        const bd = bodyDragRef.current;
        bd.lastX = e.clientX;
        bd.lastY = e.clientY;
        bd.ctrlDown = e.ctrlKey;
        const area = trackAreaRef.current;
        if (area) {
          aplicarTransformBodyDrag(e.clientX, e.clientY, e.ctrlKey);
          // Auto-pan horizontal en los bordes (igual que el playhead)
          const rect = area.getBoundingClientRect();
          const wSec = windowSecondsRef.current;
          const x = e.clientX - rect.left;
          const edgeZone = 30;
          const maxScrollSpeed = wSec * 0.5;
          if (x < edgeZone) {
            const factor = 1 - x / edgeZone;
            dragScrollVelocityRef.current = -maxScrollSpeed * factor;
          } else if (x > rect.width - edgeZone) {
            const factor = (x - (rect.width - edgeZone)) / edgeZone;
            dragScrollVelocityRef.current = maxScrollSpeed * factor;
          } else {
            dragScrollVelocityRef.current = 0;
          }
        }
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = getTimeFromMouse(e);

      if (isDraggingPlayheadRef.current) {
        const wSec = windowSecondsRef.current;
        const ws = windowStartRef.current;

        const newTime = Math.max(
          0,
          ws + ((x - TRACK_LABEL_W) / Math.max(1, rect.width - TRACK_LABEL_W)) * wSec,
        );

        const edgeZone = 30;
        const maxScrollSpeed = wSec * 0.5;
        if (x < edgeZone) {
          const factor = 1 - x / edgeZone;
          dragScrollVelocityRef.current = -maxScrollSpeed * factor;
        } else if (x > rect.width - edgeZone) {
          const factor = (x - (rect.width - edgeZone)) / edgeZone;
          dragScrollVelocityRef.current = maxScrollSpeed * factor;
        } else {
          dragScrollVelocityRef.current = 0;
        }

        const video = videoRef.current;
        if (video) {
          video.currentTime = newTime;
        }
      }

      if (isDraggingCaptionEdgeRef.current) {
        const { captionId, edge } = isDraggingCaptionEdgeRef.current;
        let newTime = Math.max(0, time);
        const cap = captionsRef.current.find((c) => c.id === captionId);
        if (cap) {
          const snap = e.ctrlKey
            ? null
            : findSnapTime(newTime, captionId, captionsRef.current);
          if (snap !== null) newTime = snap;
          if (edge === "start") {
            dragCurrentTimeRef.current = Math.min(newTime, cap.fin - 0.1);
          } else {
            dragCurrentTimeRef.current = Math.max(newTime, cap.inicio + 0.1);
          }
          updateClipDiv(captionId);
        }
      }
    }

    function onMouseUp(_e: MouseEvent) {
      if (trackHandleDraggingRef.current) {
        trackHandleDraggingRef.current = false;
        return;
      }

      if (marqueeStateRef.current?.active) {
        const ms = marqueeStateRef.current;
        marqueeStateRef.current = null;
        const ov = marqueeOverlayRef.current;
        if (ov) ov.style.display = "none";
        const area = trackAreaRef.current;
        if (area) {
          const rect = area.getBoundingClientRect();
          const areaWidth = Math.max(1, rect.width - TRACK_LABEL_W);
          const wSec = windowSecondsRef.current;
          const ws = windowStartRef.current;
          const toT = (clientX: number) =>
            ws + ((clientX - rect.left - TRACK_LABEL_W) / areaWidth) * wSec;
          const toFila = (clientY: number) =>
            (clientY - rect.top + area.scrollTop) / TRACK_H;
          const ids = filtrarPorMarquee(
            captionsRef.current,
            hablantesRef.current,
            {
              t1: toT(ms.startX),
              t2: toT(_e.clientX),
              fila1: Math.max(0, Math.floor(toFila(ms.startY))),
              fila2: Math.max(0, Math.floor(toFila(_e.clientY))),
            },
          );
          setSelectedCaptionIds((prev) => {
            if (ms.modo === "add") {
              return Array.from(new Set([...prev, ...ids]));
            }
            if (ms.modo === "toggle") {
              const set = new Set(prev);
              for (const id of ids) {
                if (set.has(id)) set.delete(id);
                else set.add(id);
              }
              return Array.from(set);
            }
            return ids;
          });
        }
        return;
      }

      if (bodyDragRef.current) {
        const bd = bodyDragRef.current;
        bodyDragRef.current = null;
        dragScrollVelocityRef.current = 0;
        // Limpiar transform y clases de los clips arrastrados
        for (const el of bd.els.values()) {
          el.style.transform = "";
          el.style.zIndex = "";
          el.classList.remove("dragging");
        }
        const area = trackAreaRef.current;
        if (area) {
          area
            .querySelectorAll(".dropTarget")
            .forEach((t) => t.classList.remove("dropTarget"));
        }
        if (bd.moved) {
          let nuevoHablanteId: string | null | undefined = undefined;
          const hablantes = hablantesRef.current;
          const fila = bd.targetFila;
          if (fila === 0) {
            nuevoHablanteId = null;
          } else if (fila > 0 && fila <= hablantes.length) {
            nuevoHablanteId = hablantes[fila - 1].id;
          }
          // Si el destino coincide con el hablante actual de TODOS los
          // clips seleccionados, no aplicar el cambio (idempotente).
          const caps = captionsRef.current.filter((c) =>
            bd.ids.includes(c.id),
          );
          if (caps.every((c) => c.hablante_id === nuevoHablanteId)) {
            nuevoHablanteId = undefined;
          }
          moverCaptions(bd.ids, bd.deltaT, nuevoHablanteId);
          justFinishedBodyDragRef.current = true;
        }
        return;
      }

      if (isDraggingPlayheadRef.current) {
        isDraggingPlayheadRef.current = false;
        dragScrollVelocityRef.current = 0;
        const video = videoRef.current;
        // Restaurar reproducción si estaba reproduciendo antes
        if (video && wasPlayingBeforeSeekRef.current) {
          video.play().catch(() => {});
          wasPlayingBeforeSeekRef.current = false; // Resetear
        }
      }

      if (isDraggingCaptionEdgeRef.current) {
        const { captionId, edge } = isDraggingCaptionEdgeRef.current;
        const sinCambio =
          dragCurrentTimeRef.current === dragStartTimeRef.current;
        if (sinCambio) {
          // Click sin arrastre sobre un borde: no commitear (sería un paso de
          // undo vacío con el mismo valor); el click del wrapper se ignora.
          justFinishedEdgeDragRef.current = true;
        } else {
          let finalTime = dragCurrentTimeRef.current;
          const cap = captionsRef.current.find((c) => c.id === captionId);
          if (cap && finalTime >= 0) {
            const snap = _e.ctrlKey
              ? null
              : findSnapTime(finalTime, captionId, captionsRef.current);
            if (snap !== null) finalTime = snap;
            if (edge === "start") {
              const clampedTime = Math.min(finalTime, cap.fin - 0.1);
              actualizarTiempoCaption(captionId, "inicio", clampedTime);
            } else {
              const clampedTime = Math.max(finalTime, cap.inicio + 0.1);
              actualizarTiempoCaption(captionId, "fin", clampedTime);
            }
          }
        }

        const el = trackAreaRef.current?.querySelector<HTMLElement>(
          `[data-caption-id="${captionId}"]`,
        );
        if (el) el.classList.remove("dragging");

        isDraggingCaptionEdgeRef.current = null;
        dragCurrentTimeRef.current = 0;
        canvas!.style.cursor = "default";
      }
    }

    function onGlobalMouseDown(e: MouseEvent) {
      // Los mousedown del timeline/trackArea llaman preventDefault(), lo que
      // suprime el blur automático del navegador sobre el textarea enfocado.
      // En fase captura (antes de cualquier preventDefault) forzamos el blur
      // si el click es fuera del editor. blur() explícito no es bloqueable.
      if (document.activeElement !== textEditorRef.current) return;
      const target = e.target as HTMLElement;
      if (target.closest(".captionEditorBox")) return;
      textEditorRef.current?.blur();
    }

    canvas.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousedown", onGlobalMouseDown, true);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      canvas.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousedown", onGlobalMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (e.shiftKey) {
          handleGuardarComo();
        } else {
          handleGuardar();
        }
        return;
      }

      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      )
        return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (e.altKey && e.code === "ArrowRight") {
        e.preventDefault();
        saltarCaption(1);
        return;
      }
      if (e.altKey && e.code === "ArrowLeft") {
        e.preventDefault();
        saltarCaption(-1);
        return;
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        saltar(5);
        return;
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        saltar(-5);
        return;
      }
      if (e.key.toLowerCase() === "e") {
        e.preventDefault();
        if (selectedCaptionIdsRef.current.length > 1) return;
        textEditorRef.current?.focus();
        return;
      }
      if (e.code === "ArrowUp") {
        e.preventDefault();
        ciclarCaptionSimultaneo(-1);
        return;
      }
      if (e.code === "ArrowDown") {
        e.preventDefault();
        ciclarCaptionSimultaneo(1);
        return;
      }
      if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        agregarFragmento();
        return;
      }
      if (e.key === "Delete") {
        e.preventDefault();
        const sel = selectedCaptionIdsRef.current;
        if (sel.length > 0) {
          eliminarSeleccion();
          return;
        }
        const idx = currentCaptionIdxRef.current;
        const cap = captionsRef.current[idx];
        if (cap) {
          eliminarCaption(cap.id);
        }
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          rehacer();
        } else {
          deshacer();
        }
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        rehacer();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        const idx = currentCaptionIdxRef.current;
        const cap = captionsRef.current[idx];
        if (cap) {
          clipboardTextRef.current = cap.texto;
        }
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        if (clipboardTextRef.current) {
          pushHistorial();
          const video = videoRef.current;
          const inicio = video ? video.currentTime : 0;
          const duracionDefault = 1.5;
          const nuevo: Caption = {
            id: `cap-paste-${Date.now()}`,
            inicio,
            fin: inicio + duracionDefault,
            texto: clipboardTextRef.current,
            hablante_id: null,
          };
          setCaptions((prev) => {
            const copy = [...prev, nuevo].sort((a, b) => a.inicio - b.inicio);
            captionsRef.current = copy;
            return copy;
          });
          setSelectedCaptionIds([nuevo.id]);
        }
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        dividirCaptionEnPlayhead();
        return;
      }

      const match = hablantesRef.current.find(
        (h) =>
          h.tecla.toLowerCase() === e.key.toLowerCase() && h.tecla.length > 0,
      );
      if (match) {
        e.preventDefault();
        asignarHablante(match.id);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    (async () => {
      unlisten = await getCurrentWebview().onDragDropEvent((event) => {
        if (event.payload.type === "over") {
          setArrastrando(true);
        } else if (event.payload.type === "drop") {
          setArrastrando(false);
          for (const p of event.payload.paths) {
            const lower = p.toLowerCase();
            if (lower.endsWith(".srt")) {
              cargarSrtDesdeRuta(p);
            } else if (EXT_VIDEO.some((ext) => lower.endsWith(ext))) {
              cargarVideoDesdeRuta(p);
            }
          }
        } else if (event.payload.type === "leave") {
          setArrastrando(false);
        }
      });
    })();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      const win = getCurrentWindow();
      unlisten = await win.onCloseRequested(async (event) => {
        event.preventDefault();

        if (isDirtyRef.current) {
          const ok = await ask(
            "Tienes cambios sin guardar. ¿Cerrar de todas formas?",
            { title: "Cambios sin guardar", kind: "warning" },
          );
          if (!ok) return;
        }

        await win.destroy();
      });
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  function handleScrollbarMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    handleScrollbarClick(e.clientX);
    const onMouseMove = (ev: MouseEvent) => {
      handleScrollbarClick(ev.clientX);
    };
    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function handleScrollbarClick(clientX: number) {
    const sb = scrollbarRef.current;
    const video = videoRef.current;
    if (!sb || !video || !video.duration) return;
    const rect = sb.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    const maxStart = Math.max(0, video.duration - windowSecondsRef.current);
    const clickTime = x * video.duration;
    const nuovo = Math.max(
      0,
      Math.min(maxStart, clickTime - windowSecondsRef.current / 2),
    );
    windowTargetRef.current = nuovo;
    isScrollingManuallyRef.current = true;
    if (autoFollowingRef.current) setAutoFollowing(false);
  }

  const handleWheelTimeline = (e: WheelEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.15 : 0.87;
      const nuevo = Math.min(
        60,
        Math.max(2, windowSecondsRef.current * factor),
      );
      windowSecondsRef.current = nuevo;
      setWindowSeconds(nuevo);
      const video = videoRef.current;
      if (video?.duration) {
        const newMaxStart = Math.max(0, video.duration - nuevo);
        if (windowStartRef.current > newMaxStart) {
          windowStartRef.current = newMaxStart;
          windowTargetRef.current = newMaxStart;
          updateScrollbarThumb(newMaxStart, nuevo, video.duration);
        }
      }
      return;
    }
    if (e.ctrlKey) {
      // Ctrl+scroll = pan lateral (moverse en el tiempo)
      e.preventDefault();
      if (!videoRef.current) return;
      const maxStart = Math.max(
        0,
        videoRef.current.duration - windowSecondsRef.current,
      );
      const panAmount = e.deltaY * 0.08;
      const newTarget = Math.max(
        0,
        Math.min(maxStart, windowTargetRef.current + panAmount),
      );
      windowTargetRef.current = newTarget;
      isScrollingManuallyRef.current = true;
      if (autoFollowingRef.current) {
        setAutoFollowing(false);
      }
      return;
    }
    // Scroll normal = subir/bajar entre los carriles de hablantes
    const area = trackAreaRef.current;
    if (area) {
      e.preventDefault();
      area.scrollTop += e.deltaY;
    }
  };

  function drawCanvasFrame(currentTime: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!canvasCtxRef.current) {
      canvasCtxRef.current = canvas.getContext("2d");
    }
    const ctx = canvasCtxRef.current;
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const clientWidth = canvas.clientWidth || 600;
    const logicalHeight = WAVEFORM_H;
    if (canvas.width !== clientWidth * dpr) canvas.width = clientWidth * dpr;
    if (canvas.height !== logicalHeight * dpr)
      canvas.height = logicalHeight * dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = clientWidth;
    const height = logicalHeight;

    ctx.fillStyle = "#1b1a20";
    ctx.fillRect(0, 0, width, height);

    const ws = windowStartRef.current;
    const wSec = windowSecondsRef.current;

    // Rejilla de tiempo (alineada con el área de carriles, que empieza en
    // TRACK_LABEL_W)
    ctx.font = '9px "JetBrains Mono", monospace';
    const tickEvery = Math.max(1, Math.round((45 / width) * wSec * 100) / 100);
    const tickStep = tickEvery <= 0.1 ? 0.1 : tickEvery <= 1 ? 0.5 : tickEvery <= 10 ? 5 : 10;
    const firstTick = Math.ceil(ws / tickStep) * tickStep;
    ctx.textBaseline = "top";
    for (let t = firstTick; t <= ws + wSec; t += tickStep) {
      const x = TRACK_LABEL_W + ((t - ws) / wSec) * (width - TRACK_LABEL_W);
      if (x < TRACK_LABEL_W || x > width) continue;
      ctx.strokeStyle = "#24232b";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
      ctx.fillStyle = "#706e7b";
      const m = Math.floor(t / 60);
      const s = Math.floor(t % 60);
      ctx.fillText(`${m}:${String(s).padStart(2, "0")}`, x + 3, 3);
    }

    const vol = volumenRef.current;
    if (vol.length > 0 && waveformPreRenderRef.current) {
      const wfCanvas = waveformPreRenderRef.current;
      const sxFloat = ws * VENTANAS_POR_SEGUNDO;
      const sx = Math.max(0, Math.floor(sxFloat));
      const frac = sxFloat - sx;
      const sw = Math.min(
        wfCanvas.width - sx,
        Math.ceil(wSec * VENTANAS_POR_SEGUNDO) + 1,
      );
      if (sw > 1) {
        ctx.imageSmoothingEnabled = false;
        ctx.save();
        ctx.translate(-frac * ((width - TRACK_LABEL_W) / sw), 0);
        ctx.drawImage(wfCanvas, sx, 0, sw, 90, TRACK_LABEL_W, 0, width - TRACK_LABEL_W, height);
        ctx.restore();
        ctx.imageSmoothingEnabled = true;
      }
    }

    // Playhead (firma): un único div HTML (.playheadLine) que cruza canvas y
    // tracks — evita pintar el playhead DENTRO del canvas (que aparecía como
    // una segunda línea).
    const enVentana = currentTime >= ws && currentTime <= ws + wSec;
    const playheadX =
      TRACK_LABEL_W +
      ((currentTime - ws) / wSec) * (width - TRACK_LABEL_W);
    const phEl = playheadLineRef.current;
    if (phEl) {
      if (enVentana) {
        phEl.style.display = "block";
        phEl.style.left = `${playheadX}px`;
      } else {
        phEl.style.display = "none";
      }
    }
  }

  const matchingCaptions = captions.filter(
    (c) => playheadTime >= c.inicio && playheadTime <= c.fin,
  );
  const currentCaption =
    matchingCaptions.find((c) => c.id === selectedCaptionId) ||
    matchingCaptions[0] ||
    null;
  const currentCaptionIdx = useMemo(
    () =>
      currentCaption
        ? captions.findIndex((c) => c.id === currentCaption.id)
        : -1,
    [captions, currentCaption],
  );
  const speakerMap = useMemo(() => {
    const map = new Map<string, Hablante>();
    for (const h of hablantes) {
      map.set(h.id, h);
    }
    speakerMapRef.current = map;
    return map;
  }, [hablantes]);

  // Follow-scroll de la lista virtual: mantiene visible el caption activo.
  // scrollIntoView con "nearest" no mueve nada si la fila ya es visible, así
  // que no pelea contra el scroll manual del usuario.
  useEffect(() => {
    if (currentCaptionIdx < 0) return;
    const caps = sortedByStartRef.current;
    const id = caps[currentCaptionIdx]?.id;
    if (!id) return;
    rowRefs.current[id]?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [currentCaptionIdx]);
  useEffect(() => {
    currentCaptionIdxRef.current = currentCaptionIdx;
    matchingCaptionsRef.current = matchingCaptions;
    // No pisar una selección múltiple con el seguimiento del playhead
    if (currentCaption && currentCaption.id !== selectedCaptionId) {
      if (selectedCaptionIds.length <= 1) {
        setSelectedCaptionIds([currentCaption.id]);
      }
    } else if (!currentCaption && selectedCaptionId !== null) {
      if (selectedCaptionIds.length <= 1) {
        setSelectedCaptionIds([]);
      }
    }
  });

  const agregarHablante = useCallback(() => {
    pushHistorial();
    setHablantes((prev) => {
      if (prev.length >= 9) return prev;
      const usadas = new Set(prev.map((h) => h.tecla));
      let tecla = "1";
      for (let i = 1; i <= 9; i++) {
        if (!usadas.has(String(i))) {
          tecla = String(i);
          break;
        }
      }
      const nuevo: Hablante = {
        id: `sp-${Date.now()}`,
        nombre: "",
        tecla,
        color: PALETA[prev.length % PALETA.length],
      };
      return [...prev, nuevo];
    });
  }, [pushHistorial, setHablantes]);

  const actualizarHablante = useCallback(
    (id: string, campo: keyof Hablante, valor: string) => {
      setHablantes((prev) => {
        const newHablantes = prev.map((h) =>
          h.id === id ? { ...h, [campo]: valor } : h,
        );
        hablantesRef.current = newHablantes;
        return newHablantes;
      });
    },
    [setHablantes],
  );

  const cambiarColorHablante = useCallback(
    (id: string, color: string) => {
      pushHistorial();
      setHablantes((prev) => {
        const newHablantes = prev.map((h) =>
          h.id === id ? { ...h, color } : h,
        );
        hablantesRef.current = newHablantes;
        return newHablantes;
      });
    },
    [pushHistorial, setHablantes],
  );

  const eliminarHablante = useCallback((id: string) => {
    pushHistorial();
    setHablantes((prev) => prev.filter((h) => h.id !== id));
    setCaptions((prev) => {
      const newCaptions = prev.map((c) =>
        c.hablante_id === id ? { ...c, hablante_id: null } : c,
      );
      captionsRef.current = newCaptions;
      return newCaptions;
    });
  }, [pushHistorial, setHablantes, setCaptions]);

  const matchingCaptionsRef = useRef<Caption[]>([]);
  function ciclarCaptionSimultaneo(direccion: 1 | -1) {
    const actual = matchingCaptionsRef.current;
    if (actual.length <= 1) return;

    const sel = selectedCaptionIdsRef.current;
    const currentId = sel.length > 0 ? sel[sel.length - 1] : "";
    const idxActual = actual.findIndex(
      (c) => c.id === currentId,
    );
    const siguienteIdx =
      (idxActual + direccion + actual.length) % actual.length;
    setSelectedCaptionIds([actual[siguienteIdx].id]);
  }

  // Carriles por hablante: uno por cada hablante + el carril "—" (sin asignar)
  const trackRows = [
    {
      label: "—",
      color: "#4a4853",
      caps: captions.filter((c) => !c.hablante_id),
    },
    ...hablantes.map((h) => ({
      label: h.nombre || h.tecla,
      color: h.color,
      caps: captions.filter((c) => c.hablante_id === h.id),
    })),
  ];

  function handleClipMouseDown(
    e: React.MouseEvent,
    cap: Caption,
    edge: "start" | "end" | null,
  ) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!edge) {
      // Drag del cuerpo: mover la selección (o este clip) en bloque.
      // Los clips quedan montados; se mueven con transform en el mousemove.
      let ids: string[];
      if (selectedCaptionIdsRef.current.includes(cap.id)) {
        ids = [...selectedCaptionIdsRef.current];
      } else {
        ids = [cap.id];
        setSelectedCaptionIds([cap.id]);
      }
      const startTimes = new Map<string, number>();
      const els = new Map<string, HTMLElement>();
      const filaOrigen = new Map<string, number>();
      const area = trackAreaRef.current;
      const tracks = area
        ? Array.from(area.querySelectorAll<HTMLElement>(".track"))
        : [];
      for (const id of ids) {
        const c = captionsRef.current.find((x) => x.id === id);
        if (c) startTimes.set(id, c.inicio);
        const el = area?.querySelector<HTMLElement>(
          `[data-caption-id="${id}"]`,
        );
        if (el) {
          els.set(id, el);
          el.classList.add("dragging");
          const trackEl = el.closest<HTMLElement>(".track");
          filaOrigen.set(
            id,
            trackEl ? tracks.indexOf(trackEl) : 0,
          );
        }
      }
      bodyDragRef.current = {
        ids,
        deltaT: 0,
        startTimes,
        moved: false,
        els,
        filaOrigen,
        targetFila: captionRowIndex(cap.hablante_id, hablantesRef.current),
        lastX: e.clientX,
        lastY: e.clientY,
        ctrlDown: false,
      };
      e.preventDefault();
      return;
    }
    isDraggingCaptionEdgeRef.current = { captionId: cap.id, edge };
    dragStartXRef.current = e.clientX;
    dragStartTimeRef.current = edge === "start" ? cap.inicio : cap.fin;
    dragCurrentTimeRef.current = dragStartTimeRef.current;
    const clipEl = (e.currentTarget as HTMLElement).closest(".clip");
    if (clipEl) clipEl.classList.add("dragging");
    e.preventDefault();
  }

  function handleClipClick(e: React.MouseEvent, cap: Caption) {
    if (justFinishedBodyDragRef.current) {
      justFinishedBodyDragRef.current = false;
      return;
    }
    if (justFinishedEdgeDragRef.current) justFinishedEdgeDragRef.current = false;
    e.stopPropagation();
    if (e.shiftKey) {
      seleccionRango(cap.id, true);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      toggleSeleccion(cap.id);
      return;
    }
    setSelectedCaptionIds([cap.id]);
    const video = videoRef.current;
    if (video) {
      const wrap = (e.currentTarget as HTMLElement).closest(".timelineWrap");
      if (wrap) {
        const rect = wrap.getBoundingClientRect();
        const wSec = windowSecondsRef.current;
        const ws = windowStartRef.current;
        const x = e.clientX - rect.left - TRACK_LABEL_W;
        const t = ws + (x / Math.max(1, rect.width - TRACK_LABEL_W)) * wSec;
        video.currentTime = Math.max(
          0,
          Math.min(video.duration || Infinity, t),
        );
      }
    }
  }

  return (
    <main className="app">
      {arrastrando && (
        <div className="dropOverlay">
          <p>Soltá el video o el .srt acá</p>
        </div>
      )}
      <div className="mainGrid">
        <div className="leftCol">
          {videoNoEncontrado ? (
            <div className="videoMissing">
              <p className="videoMissingTitle">
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
                No se encontró el video en:
              </p>
              <p className="missingPath">{rutaFaltante}</p>
              <div className="missingActions">
                <button onClick={handleAbrirVideo}>Buscar video</button>
                <button
                  className="secondary"
                  onClick={() => setVideoNoEncontrado(false)}
                >
                  Continuar sin video
                </button>
              </div>
            </div>
          ) : videoSrc ? (
            <>
              <video
                ref={videoRef}
                src={videoSrc}
                className="videoPlayer"
                muted
              />
              {audioSrc && <audio ref={audioRef} src={audioSrc} hidden />}
              <div className="playbackControls">
                <div className="transportBtnGroup">
                  <button
                    className="iconBtn"
                    onClick={() => saltar(-5)}
                    title="Retroceder 5s"
                  >
                    <svg
                      className="icon"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <path d="M2.4 2.8h2.8v10.4H2.4zM8 2.8l5.6 5.2-5.6 5.2z" />
                    </svg>
                  </button>
                  <button
                    className="iconBtn playBtn"
                    onClick={togglePlay}
                    title="Pausa / Reproducir"
                  >
                    {reproduciendo ? (
                      <svg
                        className="icon"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                      >
                        <path d="M4.4 2.6h2.8v10.8H4.4zM8.8 2.6h2.8v10.8H8.8z" />
                      </svg>
                    ) : (
                      <svg
                        className="icon"
                        viewBox="0 0 16 16"
                        fill="currentColor"
                      >
                        <path d="M4.6 2.4v11.2L13.4 8z" />
                      </svg>
                    )}
                  </button>
                  <button
                    className="iconBtn"
                    onClick={() => saltar(5)}
                    title="Adelantar 5s"
                  >
                    <svg
                      className="icon"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <path d="M2.4 2.8l5.6 5.2-5.6 5.2v-2.6L7.6 8 2.4 5.4zM10.8 2.8h2.8v10.4h-2.8z" />
                    </svg>
                  </button>
                </div>
                <input
                  className="timeInput"
                  placeholder="HH:MM:SS.ss"
                  value={
                    editandoTiempo ? timeInputValue : formatTime(playheadTime)
                  }
                  onChange={(e) => setTimeInputValue(e.target.value)}
                  onFocus={handleTimeInputFocus}
                  onBlur={handleTimeInputBlur}
                  onKeyDown={handleTimeInputKeyDown}
                  title="Click para editar, Enter para saltar ahí"
                />
                {tracks.length > 1 && (
                  <div className="trackSelectorWrap">
                    <select
                      className="trackSelector"
                      value={trackSeleccionado ?? ""}
                      onChange={(e) =>
                        setTrackSeleccionado(Number(e.target.value))
                      }
                      disabled={extrayendo}
                      data-extracting={extrayendo || undefined}
                      title="Selecciona el audio a usar en el waveform y transcripción"
                    >
                      {tracks.map((t) => (
                        <option key={t.index} value={t.index}>
                          {t.nombre && t.nombre.trim() !== ""
                            ? t.nombre
                            : `Track ${t.index + 1}`}{" "}
                          ({t.canales}ch, {t.sample_rate}Hz)
                        </option>
                      ))}
                    </select>
                    {extrayendo && (
                      <span className="extractingIndicator">
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
                        extrayendo audio...
                      </span>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="videoEmpty">
              <p>Ningún video cargado</p>
              <button onClick={handleAbrirVideo}>Elegir video</button>
            </div>
          )}

          <div className="captionEditorBox">
            {selectedCaptionIds.length > 1 ? (
              <div className="editingWhichTag">
                <span>{selectedCaptionIds.length} seleccionados</span>
                <span className="speakerChip muted">
                  <span className="dot" />
                  E deshabilitado con varios
                </span>
              </div>
            ) : (
              currentCaption && (
                <div className="editingWhichTag">
                  <span>Editando</span>
                  {(() => {
                    const sp = currentCaption.hablante_id
                      ? hablantes.find(
                          (h) => h.id === currentCaption.hablante_id,
                        )
                      : undefined;
                    return (
                      <span className="speakerChip">
                        <span
                          className="dot"
                          style={{
                            backgroundColor: sp ? sp.color : "#4a4853",
                          }}
                        />
                        {sp
                          ? sp.nombre || sp.tecla
                          : "sin hablante asignado"}
                      </span>
                    );
                  })()}
                </div>
              )
            )}
            <textarea
              ref={textEditorRef}
              className="captionEditor"
              value={currentCaption ? currentCaption.texto : ""}
              disabled={
                !currentCaption || selectedCaptionIds.length > 1
              }
              placeholder={
                currentCaption ? "" : "Sin subtítulo en este punto del video"
              }
              onChange={(e) =>
                currentCaption &&
                actualizarTextoCaption(currentCaption.id, e.target.value)
              }
              onFocus={handleEditorFocus}
              onBlur={handleEditorBlur}
              onKeyDown={handleEditorKeyDown}
            />
            <div className="captionEditorHint">
              E para editar · Enter para salir (retoma play/pausa anterior) ·
              Shift+Enter salto de línea · Alt+←/→ salta entre subtítulos · A
              para añadir · ↑/↓ cambiar entre simultaneos · Delete para eliminar
              subtitulo seleccionado
            </div>
            <button className="addFragmentBtn" onClick={agregarFragmento}>
              + Nuevo fragmento
            </button>
          </div>

          <div
            className="timelineWrap"
            ref={timelineRef}
            onClick={handleClickTimeline}
          >
            <canvas ref={canvasRef} className="timelineCanvas" />
            <div
              className="trackArea"
              ref={trackAreaRef}
              style={{ maxHeight: TRACK_VISIBLE * TRACK_H }}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                const target = e.target as HTMLElement;
                if (target.closest(".clip") || target.closest(".trackLabel")) return;
                const modo: "replace" | "add" | "toggle" = e.shiftKey
                  ? "add"
                  : e.ctrlKey || e.metaKey
                    ? "toggle"
                    : "replace";
                marqueeStateRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  active: true,
                  modo,
                };
                const ov = marqueeOverlayRef.current;
                if (ov) {
                  ov.style.left = `${e.clientX}px`;
                  ov.style.top = `${e.clientY}px`;
                  ov.style.width = "0px";
                  ov.style.height = "0px";
                  ov.style.display = "block";
                }
                if (modo === "replace") {
                  setSelectedCaptionIds([]);
                }
                e.preventDefault();
              }}
            >
              {trackRows.map((row, i) => (
                <div className="track" key={i} style={{ height: TRACK_H }}>
                  <span
                    className="trackLabel"
                    style={{ color: row.color }}
                    title={row.label}
                  >
                    {row.label}
                  </span>
                  <div className="trackClips">
                    {row.caps.map((cap) => {
                      const ws = windowStart;
                      const wSec = windowSecondsRef.current;
                      const drag = isDraggingCaptionEdgeRef.current;
                      // Durante el body drag el clip queda montado en su track
                      // y se mueve con transform (ver onMouseMove).
                      let s = cap.inicio;
                      let e = cap.fin;
                      if (drag && drag.captionId === cap.id) {
                        const t = dragCurrentTimeRef.current;
                        if (drag.edge === "start") s = t;
                        else e = t;
                      }
                      s = Math.max(s, ws);
                      e = Math.min(e, ws + wSec);
                      if (e <= s) return null;
                      const left = ((s - ws) / wSec) * 100;
                      const width = ((e - s) / wSec) * 100;
                      return (
                        <div
                          key={cap.id}
                          data-caption-id={cap.id}
                          className={
                            "clip" +
                            (selectedCaptionIds.includes(cap.id)
                              ? " selected"
                              : "")
                          }
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            background: row.color,
                          }}
                          onMouseDown={(ev) => handleClipMouseDown(ev, cap, null)}
                          onClick={(ev) => handleClipClick(ev, cap)}
                          title={cap.texto}
                        >
                          <span className="clipText">{cap.texto}</span>
                          <span
                            className="clipEdge left"
                            onMouseDown={(ev) =>
                              handleClipMouseDown(ev, cap, "start")
                            }
                          />
                          <span
                            className="clipEdge right"
                            onMouseDown={(ev) =>
                              handleClipMouseDown(ev, cap, "end")
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
</div>
              ))}
            </div>
            <div className="playheadLine" ref={playheadLineRef} />
            <div ref={marqueeOverlayRef} className="marqueeOverlay" style={{ display: "none" }} />
            <div
              className="trackHandle"
              ref={trackHandleRef}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                trackHandleDraggingRef.current = true;
                e.preventDefault();
              }}
              onClick={(e) => e.stopPropagation()}
              title="Arrastrar para expandir la vista de carriles"
            >
              <svg
                className="icon xs"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.3}
                strokeLinecap="round"
              >
                <path d="M8 2.2v11.6M5.2 5.2 8 2.4l2.8 2.8M5.2 10.8 8 13.6l2.8-2.8" />
              </svg>
              <span>arrastrar para expandir</span>
            </div>
          </div>
          {videoDuration > 0 && (
            <div
              className="timelineScrollbar"
              ref={scrollbarRef}
              onMouseDown={handleScrollbarMouseDown}
            >
              <div
                ref={scrollbarThumbRef}
                className="timelineScrollbarThumb"
                style={(() => {
                  const thumbWidthPct =
                    videoDuration > 0
                      ? (windowSeconds / videoDuration) * 100
                      : 100;
                  const range = Math.max(1, videoDuration - windowSeconds);
                  const leftPct =
                    videoDuration > windowSeconds
                      ? (windowStartRef.current / range) * (100 - thumbWidthPct)
                      : 0;
                  return {
                    left: `${leftPct}%`,
                    width: `${Math.min(thumbWidthPct, 100)}%`,
                  };
                })()}
              />
            </div>
          )}
          <div className="timelineToolbar">
            <span className="zoomLabel">
              {analizando
                ? `Analizando audio... ${(volumen.length / VENTANAS_POR_SEGUNDO).toFixed(0)}s procesados`
                : `Zoom: ${windowSeconds.toFixed(1)}s · Shift+scroll zoom · scroll navegar · arrastrar bordes con snap`}
            </span>
            <button
              className={`followBtn ${autoFollowing ? "active" : ""}`}
              onClick={() => {
                const nuevo = !autoFollowing;
                setAutoFollowing(nuevo);
                if (nuevo) {
                  const video = videoRef.current;
                  if (video) {
                    const t = video.currentTime;
                    const wSec = windowSecondsRef.current;
                    windowStartRef.current = Math.max(0, t - wSec * 0.1);
                    windowTargetRef.current = windowStartRef.current;
                    updateScrollbarThumb(windowStartRef.current, wSec, video.duration);
                  }
                  isScrollingManuallyRef.current = false;
                }
              }}
              title="Seguir playhead automáticamente"
            >
              <svg
                className="icon sm"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <circle cx="8" cy="8" r="2.6" />
                <path d="M8 1.6v2.4M8 12v2.4M1.6 8h2.4M12 8h2.4" />
              </svg>
              {autoFollowing ? "Seguir" : "Manual"}
            </button>
          </div>

          <div className="statusBar">
            {rutaProyecto ? (
              <>
                <span className={`saveState ${hayCambios ? "dirty" : "clean"}`}>
                  <span className="saveDot" />
                  {hayCambios ? "Sin guardar" : "Guardado"}
                </span>
                <span className="statusPath">{rutaProyecto}</span>
              </>
            ) : (
              <span className="muted">Proyecto sin guardar</span>
            )}
            {exportMensaje && (
              <div className="exportMensaje">{exportMensaje}</div>
            )}
            <span className="statusHint">¿ para ayuda · Shift+scroll zoom</span>
          </div>
        </div>

        <div className="rightCol">
          <SpeakersPanel
            hablantes={hablantes}
            panelAbierto={panelHablantesAbierto}
            onTogglePanel={togglePanelHablantes}
            onAgregar={agregarHablante}
            onActualizar={actualizarHablante}
            onCambiarColor={cambiarColorHablante}
            onEliminar={eliminarHablante}
            onCommit={pushHistorial}
          />

          <WhisperPanel
            modelos={modelos}
            modeloSeleccionado={modeloSeleccionado}
            descargandoModelo={descargandoModelo}
            progresoDescarga={progresoDescarga}
            estadoDescarga={estadoDescarga}
            errorDescarga={errorDescarga}
            bytesDescargados={bytesDescargados}
            bytesTotal={bytesTotal}
            panelAbierto={panelModelosAbierto}
            transcribiendo={transcribiendo}
            transcripcionProgreso={transcripcionProgreso}
            errorTranscripcion={errorTranscripcion}
            tracks={tracks}
            tracksSeleccionados={tracksSeleccionados}
            glosarioGlobal={glosarioGlobal}
            glosario={glosario}
            idioma={idiomaWhisper}
            modoMuestreo={modoMuestreoWhisper}
            onTogglePanel={togglePanelModelos}
            onSelectModelo={setModeloSeleccionado}
            onDescargarModelo={handleDescargarModelo}
            onEliminarModelo={handleEliminarModelo}
            onTranscribir={handleTranscribir}
            onToggleTrack={toggleTrack}
            onGlosarioGlobalChange={setGlosarioGlobal}
            onGlosarioChange={setGlosario}
            onIdiomaChange={setIdiomaWhisper}
            onModoMuestreoChange={setModoMuestreoWhisper}
          />
          <div className="rightColHeader">
            <span className="rightColTitle">Subtítulos</span>
            {captions.length > 0 && (
              <span className="captionCount">{captions.length} líneas</span>
            )}
          </div>
          <CaptionList
            captions={captions}
            currentCaptionIdx={currentCaptionIdx}
            selectedCaptionIds={selectedCaptionIds}
            onSelectCaption={handleSelectCaption}
            onEliminarCaption={eliminarCaption}
            rowRefs={rowRefs}
            speakerMap={speakerMap}
          />
        </div>
      </div>

      {showHelp && (
        <div className="helpOverlay" onClick={() => setShowHelp(false)}>
          <div className="helpModal" onClick={(e) => e.stopPropagation()}>
            <h2>Atajos de teclado</h2>
            <table className="helpTable">
              <tbody>
                <tr>
                  <td>
                    <kbd>?</kbd>
                  </td>
                  <td>Abrir/cerrar esta ayuda</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Espacio</kbd>
                  </td>
                  <td>Reproducir / Pausar</td>
                </tr>
                <tr>
                  <td>
                    <kbd>→</kbd> / <kbd>←</kbd>
                  </td>
                  <td>Adelantar / Retroceder 5s</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Alt</kbd>+<kbd>→</kbd> / <kbd>Alt</kbd>+<kbd>←</kbd>
                  </td>
                  <td>Saltar al siguiente / anterior subtítulo</td>
                </tr>
                <tr>
                  <td>
                    <kbd>↑</kbd> / <kbd>↓</kbd>
                  </td>
                  <td>Cambiar entre subtítulos simultáneos</td>
                </tr>
                <tr>
                  <td>
                    <kbd>A</kbd>
                  </td>
                  <td>Añadir nuevo fragmento</td>
                </tr>
                <tr>
                  <td>
                    <kbd>C</kbd>
                  </td>
                  <td>Dividir subtítulo en el playhead</td>
                </tr>
                <tr>
                  <td>
                    <kbd>E</kbd>
                  </td>
                  <td>Editar texto del subtítulo</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Delete</kbd>
                  </td>
                  <td>Eliminar subtítulo seleccionado</td>
                </tr>
                <tr>
                  <td>
                    <kbd>1</kbd>–<kbd>9</kbd>
                  </td>
                  <td>Asignar hablante al subtítulo</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd>+<kbd>Z</kbd>
                  </td>
                  <td>Deshacer</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> /{" "}
                    <kbd>Ctrl</kbd>+<kbd>Y</kbd>
                  </td>
                  <td>Rehacer</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd>+<kbd>S</kbd>
                  </td>
                  <td>Guardar proyecto</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>
                  </td>
                  <td>Guardar como...</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd>+<kbd>C</kbd>
                  </td>
                  <td>Copiar texto del subtítulo</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd>+<kbd>V</kbd>
                  </td>
                  <td>Pegar como nuevo subtítulo</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Shift</kbd>+<kbd>scroll</kbd>
                  </td>
                  <td>Zoom del timeline (2–60s)</td>
                </tr>
                <tr>
                  <td>
                    <kbd>scroll</kbd>
                  </td>
                  <td>Navegar por el timeline</td>
                </tr>
                <tr>
                  <td>
                    <kbd>Ctrl</kbd>+<kbd>arrastre</kbd>
                  </td>
                  <td>Desactivar snap al mover bordes</td>
                </tr>
              </tbody>
            </table>
            <button
              className="addFragmentBtn"
              onClick={() => setShowHelp(false)}
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
