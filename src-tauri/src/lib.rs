mod postprocess;

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri::Manager;

// Guard de concurrencia: evita dos transcripciones simultáneas (cada una carga
// un WhisperContext de hasta ~3GB en RAM) y dos análisis de volumen del mismo
// track emitiendo chunks duplicados al frontend. El semáforo de tokio (en vez
// de un Mutex de std) permite que el permit cruce los awaits del comando.
static TRANSCRIBIENDO: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
static ANALIZANDO: std::sync::LazyLock<std::sync::Mutex<std::collections::HashSet<(String, usize)>>> =
    std::sync::LazyLock::new(|| {
        std::sync::Mutex::new(std::collections::HashSet::new())
    });

// Limpia el registro de análisis en vuelo al dropearse (pase lo que pase en el
// cuerpo del análisis), para que un error no bloquee análisis futuros.
struct AnalisisGuard {
    ruta: String,
    idx: usize,
}
impl Drop for AnalisisGuard {
    fn drop(&mut self) {
        if let Ok(mut set) = ANALIZANDO.lock() {
            set.remove(&(self.ruta.clone(), self.idx));
        }
    }
}

// Escritura atómica: escribe a un .tmp y renombra. Un crash/fallo a mitad
// nunca deja el destino final corrupto (archivos de usuario, caches, SRT).
fn escribir_atomico(ruta: &std::path::Path, contenido: &[u8]) -> Result<(), String> {
    let tmp = ruta.with_extension("tmp");
    std::fs::write(&tmp, contenido).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, ruta).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Error finalizando escritura: {}", e)
    })
}

fn carpeta_vad(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("vad_models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn ruta_modelo_vad(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(carpeta_vad(app)?.join("ggml-silero-v5.1.2.bin"))
}

async fn descargar_modelo_vad(app: &tauri::AppHandle) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let destino = ruta_modelo_vad(app)?;
    if destino.exists() {
        return Ok(());
    }
    // .part único por proceso: dos llamadas concurrentes no se pisan el archivo
    let destino_part = destino.with_extension(format!("part-{}", std::process::id()));
    let url = "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin";
    println!("[VAD] Descargando modelo desde {}", url);
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("Error descargando VAD: {}", e))?;
    if !resp.status().is_success() {
        let _ = tokio::fs::remove_file(&destino_part).await;
        return Err(format!(
            "No se pudo descargar el modelo VAD (HTTP {})",
            resp.status()
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Error leyendo VAD: {}", e))?;
    let mut file = tokio::fs::File::create(&destino_part)
        .await
        .map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .await
        .map_err(|e| e.to_string())?;
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    if destino.exists() {
        let _ = tokio::fs::remove_file(&destino).await;
    }
    tokio::fs::rename(&destino_part, &destino)
        .await
        .map_err(|e| {
            let _ = std::fs::remove_file(&destino_part);
            format!("Error finalizando descarga VAD: {}", e)
        })?;
    println!("[VAD] Descargado: {} bytes", bytes.len());
    Ok(())
}

fn run_vad_sync(vad_model_path: &str, audio_f32: &[f32]) -> Result<Vec<(usize, usize)>, String> {
    use whisper_rs::{WhisperVadContext, WhisperVadContextParams, WhisperVadParams};
    let ctx = WhisperVadContext::new(vad_model_path, WhisperVadContextParams::new())
        .map_err(|e| format!("WhisperVadContext error: {:?}", e))?;
    let mut vad = ctx;
    let mut vadp = WhisperVadParams::new();
    vadp.set_min_silence_duration(500);
    let segs = vad
        .segments_from_samples(vadp, audio_f32)
        .map_err(|e| format!("VAD error: {:?}", e))?;
    let sr = 16000.0;
    let n = audio_f32.len() as f64;
    let result: Vec<(usize, usize)> = segs
        .map(|s| {
            let start_sec = s.start as f64 / 100.0;
            let end_sec = s.end as f64 / 100.0;
            let start_idx = (start_sec * sr).round().clamp(0.0, n) as usize;
            let end_idx = (end_sec * sr).round().clamp(0.0, n) as usize;
            (start_idx, end_idx)
        })
        .filter(|(a, b)| b > a)
        .collect();
    println!("[VAD] {} segmentos detectados", result.len());
    for (i, &(a, b)) in result.iter().enumerate() {
        println!(
            "[VAD]   seg[{}]: {:.2}s-{:.2}s ({} samples)",
            i,
            a as f64 / sr,
            b as f64 / sr,
            b - a
        );
    }
    Ok(result)
}

#[derive(Serialize, Clone)]
struct SegmentoTranscrito {
    inicio: f64,
    fin: f64,
    texto: String,
    speaker_id: Option<String>,
}

fn diarizar_get_turns(audio: &[f32], max_speakers: u8) -> Result<Vec<polyvoice::SpeakerTurn>, String> {
    use polyvoice::pipeline_v2::{Pipeline, PipelineConfig, ClustererKind};
    use polyvoice::types::SampleRate;

    let max_sp = max_speakers.clamp(1, 20);
    let config = PipelineConfig {
        max_speakers: max_sp,
        min_cluster_size: 1,
        max_gap_secs: 1.0,
        min_speech_secs: 0.3,
        clusterer: ClustererKind::Ahc { threshold: 0.40 },
        ..PipelineConfig::default()
    };

    let pipeline = Pipeline::builder()
        .config(config)
        .with_models_from(polyvoice::models::ModelRegistry::default().map_err(|e| format!("ModelRegistry: {}", e))?)
        .build()
        .map_err(|e| format!("Pipeline build: {:?}", e))?;

    let sr = SampleRate::new(16000).ok_or("SampleRate: 16000 no válido")?;
    let result = pipeline
        .run(audio, sr)
        .map_err(|e| format!("Pipeline run: {:?}", e))?;

    println!("[DIAR] polyvoice: {} speakers, {} turns", result.num_speakers, result.turns.len());
    for (i, t) in result.turns.iter().enumerate() {
        println!("[DIAR]   turn[{}] speaker={:?} {:.3}s-{:.3}s", i, t.speaker, t.time.start, t.time.end);
    }

    Ok(result.turns)
}

// Índice precomputado de turns (los turnos llegan ordenados cronológicamente):
// evita recorrer la lista completa por cada token (~100k tokens) y aloca el
// nombre del speaker solo una vez por turn.
fn indice_turns(turns: &[polyvoice::SpeakerTurn]) -> Vec<(f64, f64, String)> {
    turns
        .iter()
        .map(|t| (t.time.start, t.time.end, format!("{:?}", t.speaker)))
        .collect()
}

fn find_speaker_for_time(t: f64, index: &[(f64, f64, String)]) -> Option<&str> {
    let lo = index.partition_point(|&(s, _, _)| s < t - 1.5);
    let hi = index.partition_point(|&(s, _, _)| s <= t + 1.5);
    let mut best: Option<(f64, &str)> = None;
    for &(s, e, ref sp) in &index[lo..hi] {
        let dist = if t < s { s - t } else if t > e { t - e } else { 0.0 };
        if dist <= 1.5 && best.map_or(true, |(d, _)| dist < d) {
            best = Some((dist, sp));
        }
    }
    best.map(|(_, sp)| sp)
}

fn calcular_cache_key(ruta_video: &str) -> Result<String, String> {
    let metadata = std::fs::metadata(ruta_video).map_err(|e| e.to_string())?;
    let size = metadata.len();
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let mut hasher = DefaultHasher::new();
    ruta_video.hash(&mut hasher);
    size.hash(&mut hasher);
    modified.hash(&mut hasher);
    // Dos videos distintos con mismo tamaño y mtime compartirían cache; mezclar
    // los primeros 4KB del contenido elimina la colisión práctica.
    if let Ok(mut f) = std::fs::File::open(ruta_video) {
        use std::io::Read;
        let mut buf = [0u8; 4096];
        let mut total = 0usize;
        while total < buf.len() {
            match f.read(&mut buf[total..]) {
                Ok(0) => break,
                Ok(n) => total += n,
                Err(_) => break,
            }
        }
        buf[..total].hash(&mut hasher);
    }
    let hash = hasher.finish();

    Ok(format!("{:x}", hash))
}

fn ruta_cache_para(
    app: &tauri::AppHandle,
    ruta_video: &str,
    track_index: Option<usize>,
) -> Result<std::path::PathBuf, String> {
    let key = calcular_cache_key(ruta_video)?;
    let track_suffix = track_index.map(|i| format!("_{}", i)).unwrap_or_default();
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("audio_cache");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(format!("{}{}.cache", key, track_suffix)))
}

fn guardar_cache_volumen(
    app: &tauri::AppHandle,
    ruta_video: &str,
    track_index: Option<usize>,
    datos: &[f32],
) -> Result<(), String> {
    let path = ruta_cache_para(app, ruta_video, track_index)?;
    let mut bytes = Vec::with_capacity(datos.len() * 4);
    for &v in datos {
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    escribir_atomico(&path, &bytes)
}

#[tauri::command]
fn existe_cache_volumen(
    app: tauri::AppHandle,
    ruta_video: String,
    track_index: Option<usize>,
) -> bool {
    match ruta_cache_para(&app, &ruta_video, track_index) {
        Ok(path) => path.exists(),
        Err(_) => false,
    }
}

#[tauri::command]
async fn cargar_cache_volumen(
    app: tauri::AppHandle,
    ruta_video: String,
    track_index: Option<usize>,
) -> Result<Vec<f32>, String> {
    let path = ruta_cache_para(&app, &ruta_video, track_index)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.is_empty() || bytes.len() % 4 != 0 {
            // Cache corrupto (crash a mitad de escritura): descartar y re-analizar
            let _ = std::fs::remove_file(&path);
            return Err("Cache de volumen corrupto, se re-analizará".to_string());
        }
        let mut resultado = Vec::with_capacity(bytes.len() / 4);
        for chunk in bytes.chunks_exact(4) {
            let arr: [u8; 4] = chunk
                .try_into()
                .map_err(|_| "Error leyendo cache".to_string())?;
            resultado.push(f32::from_le_bytes(arr));
        }
        Ok(resultado)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Deserialize)]
struct Hablante {
    id: String,
    nombre: String,
    tecla: String,
    color: String,
}

#[derive(Serialize, Deserialize)]
struct Caption {
    id: String,
    inicio: f64,
    fin: f64,
    texto: String,
    hablante_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Proyecto {
    ruta_video: String,
    hablantes: Vec<Hablante>,
    captions: Vec<Caption>,
    #[serde(default)]
    playhead: f64,
}

struct ModeloWhisperInfo {
    id: &'static str,
    label: &'static str,
    archivo: &'static str,
    tamano_mb_aprox: u32,
}

const MODELOS_DISPONIBLES: &[ModeloWhisperInfo] = &[
    ModeloWhisperInfo {
        id: "tiny",
        label: "Tiny (rápido, menos preciso)",
        archivo: "ggml-tiny.bin",
        tamano_mb_aprox: 75,
    },
    ModeloWhisperInfo {
        id: "base",
        label: "Base (balance recomendado)",
        archivo: "ggml-base.bin",
        tamano_mb_aprox: 148,
    },
    ModeloWhisperInfo {
        id: "small",
        label: "Small (más preciso, más lento)",
        archivo: "ggml-small.bin",
        tamano_mb_aprox: 488,
    },
    ModeloWhisperInfo {
        id: "medium",
        label: "Medium (alta precisión, pesado)",
        archivo: "ggml-medium.bin",
        tamano_mb_aprox: 1530,
    },
    ModeloWhisperInfo {
        id: "large-v3",
        label: "Large v3 (máxima precisión, muy pesado)",
        archivo: "ggml-large-v3.bin",
        tamano_mb_aprox: 3100,
    },
    ModeloWhisperInfo {
        id: "large-v3-turbo",
        label: "Large v3 Turbo (alta precisión, más rápido que large-v3)",
        archivo: "ggml-large-v3-turbo.bin",
        tamano_mb_aprox: 1550,
    },
];

#[derive(Serialize)]
struct ModeloInfo {
    id: String,
    label: String,
    tamano_mb_aprox: u32,
    descargado: bool,
}

#[derive(Serialize)]
struct TrackInfo {
    index: usize,
    nombre: String,
    canales: u16,
    sample_rate: u32,
}

#[tauri::command]
async fn listar_tracks_audio(ruta: String) -> Result<Vec<TrackInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use symphonia::core::formats::FormatOptions;
        use symphonia::core::io::MediaSourceStream;
        use symphonia::core::meta::MetadataOptions;
        use symphonia::core::probe::Hint;

        let file = std::fs::File::open(&ruta).map_err(|e| e.to_string())?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());
        let mut hint = Hint::new();
        if let Some(ext) = std::path::Path::new(&ruta)
            .extension()
            .and_then(|e| e.to_str())
        {
            hint.with_extension(ext);
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .map_err(|e| e.to_string())?;

        let format = probed.format;
        let mut resultado = Vec::new();

        for (i, track) in format
            .tracks()
            .iter()
            .filter(|t| t.codec_params.sample_rate.is_some())
            .enumerate()
        {
            let canales = track
                .codec_params
                .channels
                .map(|c| c.count() as u16)
                .unwrap_or(2);
            let sample_rate = track.codec_params.sample_rate.unwrap();
            println!(
                "[TRACKS] symphonia asigna índice {} al stream_id={:?} ({}ch, {}Hz)",
                i, track.id, canales, sample_rate
            );
            resultado.push(TrackInfo {
                index: i,
                nombre: format!("Track {}", i + 1),
                canales,
                sample_rate,
            });
        }

        Ok(resultado)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn carpeta_modelos(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("whisper_models");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn ruta_modelo_por_id(app: &tauri::AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    let info = MODELOS_DISPONIBLES
        .iter()
        .find(|m| m.id == id)
        .ok_or("Modelo desconocido")?;
    Ok(carpeta_modelos(app)?.join(info.archivo))
}

// Lee el stdout f32le de ffmpeg en chunks y convierte incrementalmente a f32.
// Con `.output()` todo el PCM (un video de 2h = ~460MB) se bufferiza dos veces;
// acá el pico queda en un solo Vec de muestras.
fn leer_stdout_f32(mut child: std::process::Child) -> Result<Vec<f32>, String> {
    use std::io::Read;
    let mut stdout = child
        .stdout
        .take()
        .ok_or("ffmpeg no expuso stdout")?;
    let mut muestras: Vec<f32> = Vec::new();
    let mut buf = [0u8; 65536];
    let mut resto = [0u8; 4];
    let mut resto_len = 0usize;
    loop {
        let n = match stdout.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(e) => {
                let _ = child.kill();
                return Err(format!("Error leyendo audio de ffmpeg: {}", e));
            }
        };
        let mut i = 0usize;
        if resto_len > 0 {
            let need = 4 - resto_len;
            let take = need.min(n);
            resto[resto_len..resto_len + take].copy_from_slice(&buf[..take]);
            resto_len += take;
            i = take;
            if resto_len == 4 {
                muestras.push(f32::from_le_bytes(resto));
                resto_len = 0;
            }
        }
        let bytes = &buf[i..n];
        let mut chunks = bytes.chunks_exact(4);
        for c in &mut chunks {
            muestras.push(f32::from_le_bytes([c[0], c[1], c[2], c[3]]));
        }
        let rem = chunks.remainder();
        if !rem.is_empty() {
            resto[..rem.len()].copy_from_slice(rem);
            resto_len = rem.len();
        }
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "ffmpeg falló: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(muestras)
}

fn decodificar_audio_16k_track(ruta: &str, track_index: usize) -> Result<Vec<f32>, String> {
    println!(
        "[WHISPER_PCM] ffmpeg -i \"{}\" -map 0:a:{} -ac 1 -ar 16000 -f f32le - (pipe)",
        ruta, track_index
    );
let child = std::process::Command::new("ffmpeg")
        .args([
            "-hide_banner",
            "-nostdin",
            "-loglevel",
            "error",
            "-i",
            &ruta,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-f",
            "f32le",
            "-",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Error ejecutando ffmpeg: {}", e))?;
    leer_stdout_f32(child)
}

fn decodificar_audio_16k_combinado(
    ruta: &str,
    track_indices: &[usize],
) -> Result<Vec<f32>, String> {
    println!(
        "[WHISPER_PCM] Combinando tracks {:?} desde {}",
        track_indices, ruta
    );
    let inputs: Vec<String> = track_indices
        .iter()
        .map(|i| format!("[0:a:{}]", i))
        .collect();
    let amix = format!(
        "{}amix=inputs={}:duration=first:normalize=0,aresample=16000[a]",
        inputs.join(""),
        track_indices.len()
    );

    let child = std::process::Command::new("ffmpeg")
        .args([
            "-loglevel",
            "error",
            "-i",
            ruta,
            "-filter_complex",
            &amix,
            "-map",
            "[a]",
            "-ac",
            "1",
            "-f",
            "f32le",
            "-",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Error ejecutando ffmpeg: {}", e))?;
    leer_stdout_f32(child)
}

#[tauri::command]
fn listar_modelos(app: tauri::AppHandle) -> Result<Vec<ModeloInfo>, String> {
    let dir = carpeta_modelos(&app)?;
    let mut result = Vec::new();
    for m in MODELOS_DISPONIBLES {
        let path = dir.join(m.archivo);
        result.push(ModeloInfo {
            id: m.id.to_string(),
            label: m.label.to_string(),
            tamano_mb_aprox: m.tamano_mb_aprox,
            descargado: path.exists(),
        });
    }
    Ok(result)
}

#[tauri::command]
async fn transcribir_video(
    app: tauri::AppHandle,
    ruta_video: String,
    modelo_id: String,
    track_indices: Vec<usize>,
    max_speakers: u8,
    glosario: Option<String>,
    idioma: Option<String>,
    modo_muestreo: Option<String>,
    diarizador: Option<String>,
) -> Result<Vec<SegmentoTranscrito>, String> {
    // Un solo WhisperContext a la vez: cada transcripción carga el modelo en RAM
    // (large-v3 ≈ 3GB) en su thread dedicado. El permit vive hasta que termina.
    let _permiso = TRANSCRIBIENDO
        .try_acquire()
        .map_err(|_| "Ya hay una transcripción en curso".to_string())?;
    let ruta_modelo = ruta_modelo_por_id(&app, &modelo_id)?;
    if !ruta_modelo.exists() {
        return Err("El modelo seleccionado no está descargado".to_string());
    }
    if track_indices.is_empty() {
        return Err("No se seleccionó ninguna pista de audio".to_string());
    }

    // Descargar modelo VAD antes de entrar al thread bloqueante
    let _ = descargar_modelo_vad(&app).await;

    // Ejecutar en thread dedicado con 8MB de stack (whisper.cpp necesita más stack)
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<Vec<SegmentoTranscrito>, String>>();
    std::thread::Builder::new()
        .stack_size(8 * 1024 * 1024)
        .name("whisper-transcripcion".into())
        .spawn(move || {
            let result = (|| -> Result<Vec<SegmentoTranscrito>, String> {
                use whisper_rs::{
                    FullParams, SamplingStrategy, WhisperContext,
                    WhisperContextParameters,
                };
                let app_clone = app.clone();
                let emit_progreso = |fase: &str, progreso: i32, mensaje: &str| {
                    let _ = app_clone.emit(
                        "transcripcion_progreso",
                        serde_json::json!({
                            "fase": fase,
                            "progreso": progreso,
                            "mensaje": mensaje,
                        }),
                    );
                };
                whisper_rs::install_logging_hooks(); // apaga el spam de whisper.cpp/GGML a stdout
                let audio = if track_indices.len() == 1 {
            decodificar_audio_16k_track(&ruta_video, track_indices[0])?
        } else {
            decodificar_audio_16k_combinado(&ruta_video, &track_indices)?
        };

        println!("[WHISPER] ====== DEBUG INFO ======");
        let ctx_params_default = WhisperContextParameters::default();
        println!(
            "[WHISPER] use_gpu: {}",
            ctx_params_default.use_gpu
        );
        println!(
            "[WHISPER] gpu_device: {}",
            ctx_params_default.gpu_device
        );
        println!("[WHISPER] dtw_mode: ModelPreset");
        println!(
            "[WHISPER] system_info:\n{}",
            whisper_rs::print_system_info()
        );

        let devices = whisper_rs::vulkan::list_devices();
        println!("[WHISPER] Vulkan devices found: {}", devices.len());
        for dev in &devices {
            println!(
                "[WHISPER]   GPU[{}] {} — VRAM: {:.2} GiB free / {:.2} GiB total",
                dev.id,
                dev.name,
                dev.vram.free as f64 / (1024.0 * 1024.0 * 1024.0),
                dev.vram.total as f64 / (1024.0 * 1024.0 * 1024.0),
            );
        }

        let ctx = WhisperContext::new_with_params(
            ruta_modelo.to_str().ok_or("Ruta de modelo inválida")?,
            ctx_params_default,
        )
        .map_err(|e| e.to_string())?;

        println!("[WHISPER] WhisperContext created successfully");

        // --- VAD ---
        emit_progreso("vad", 0, "Separando audio con VAD...");
        let sps: Vec<(usize, usize)> = {
            let vad_path = ruta_modelo_vad(&app);
            match vad_path {
                Ok(ref p) if p.exists() => {
                    match run_vad_sync(p.to_str().ok_or("ruta VAD inválida")?, &audio) {
                        Ok(s) => {
                            println!("[VAD] Usando VAD con {} segmentos", s.len());
                            s
                        }
                        Err(e) => {
                            println!("[VAD] Error: {}, transcribiendo audio completo", e);
                            vec![]
                        }
                    }
                }
                _ => {
                    println!("[VAD] Modelo no encontrado, transcribiendo audio completo");
                    vec![]
                }
            }
        };
        let total_segs = sps.len();
        emit_progreso(
            "vad",
            100,
            &format!("VAD detectó {} segmentos", total_segs.max(1)),
        );

        let strategy = match modo_muestreo.as_deref() {
            Some("greedy") => SamplingStrategy::Greedy { best_of: 1 },
            _ => SamplingStrategy::BeamSearch { beam_size: 5, patience: -1.0 },
        };
        let mut params = FullParams::new(strategy);

        let lang = match idioma.as_deref() {
            Some("auto") | None | Some("") => None,
            Some(l) => Some(l),
        };
        params.set_language(lang);
        params.set_suppress_blank(true);
        params.set_no_speech_thold(0.4);
        params.set_token_timestamps(true);
        params.set_split_on_word(true);
        params.set_max_len(42);
        params.set_single_segment(false);
        params.set_temperature_inc(0.2);
        params.set_entropy_thold(2.4);
        params.set_logprob_thold(-1.0);
        if let Some(ref prompt) = glosario {
            if !prompt.trim().is_empty() {
                params.set_initial_prompt(prompt);
            }
        }

        struct RawToken {
            texto: String,
            inicio: f64,
            fin: f64,
            es_inicio_segmento: bool,
        }

        let mut raw_tokens: Vec<RawToken> = Vec::new();

        // Un solo state reutilizado entre segmentos (whisper_rs lo permite; evita
        // re-alocar los buffers internos por cada segmento VAD).
        let mut state = ctx.create_state().map_err(|e| e.to_string())?;

        if sps.is_empty() {
            // Sin VAD: transcribir audio completo (puede tardar minutos sin
            // ningún evento; el callback de whisper reporta el progreso real
            // 0-100 para que la UI no parezca colgada).
            let hb_app = app_clone.clone();
            params.set_progress_callback_safe(move |progreso| {
                let _ = hb_app.emit(
                    "transcripcion_progreso",
                    serde_json::json!({
                        "fase": "transcribiendo",
                        "progreso": progreso,
                        "mensaje": format!("Transcribiendo audio completo... {}%", progreso),
                    }),
                );
            });
            state.full(params, &audio[..]).map_err(|e| e.to_string())?;
            println!(
                "[POST] whisper_full completado, n_segs={}",
                state.full_n_segments()
            );
            let n_segs = state.full_n_segments();
            for seg_idx in 0..n_segs {
                let segment = match state.get_segment(seg_idx) {
                    Some(s) => s,
                    None => continue,
                };
                let n_toks = segment.n_tokens();
                let mut primer_token = true;
                for tok_idx in 0..n_toks {
                    let token = match segment.get_token(tok_idx) {
                        Some(t) => t,
                        None => continue,
                    };
                    let texto = token.to_str_lossy().unwrap_or_default().to_string();
                    let trimmed = texto.trim();
                    if trimmed.is_empty() {
                        continue;
                    }
                    if trimmed.starts_with('[') && trimmed.ends_with(']') {
                        continue;
                    }
                    let data = token.token_data();
                    if data.t0 < 0 || data.t1 < 0 {
                        continue;
                    }
                    raw_tokens.push(RawToken {
                        texto,
                        inicio: data.t0 as f64 / 100.0,
                        fin: data.t1 as f64 / 100.0,
                        es_inicio_segmento: primer_token,
                    });
                    primer_token = false;
                }
            }
            // Fallback a segmentos
            if raw_tokens.is_empty() {
                for seg_idx in 0..n_segs {
                    let segment = match state.get_segment(seg_idx) {
                        Some(s) => s,
                        None => continue,
                    };
                    let texto = segment.to_str_lossy().unwrap_or_default().to_string();
                    let texto = texto.trim().to_string();
                    if texto.is_empty() || (texto.starts_with('[') && texto.ends_with(']')) {
                        continue;
                    }
                    raw_tokens.push(RawToken {
                        texto: format!(" {}", texto),
                        inicio: segment.start_timestamp() as f64 / 100.0,
                        fin: segment.end_timestamp() as f64 / 100.0,
                        es_inicio_segmento: true,
                    });
                }
            }
        } else {
            // Con VAD: transcribir cada segmento
            for (seg_idx, &(start_idx, end_idx)) in sps.iter().enumerate() {
                let pct = 10 + ((seg_idx as f64 / total_segs as f64) * 90.0) as i32;
                emit_progreso(
                    "transcribiendo",
                    pct,
                    &format!("Transcribiendo segmento {}/{}...", seg_idx + 1, total_segs),
                );
                let seg_audio = &audio[start_idx..end_idx];
                if seg_audio.len() < 160 {
                    continue;
                } // <10ms, saltar
                let offset_s = start_idx as f64 / 16000.0;
                state
                    .full(params.clone(), seg_audio)
                    .map_err(|e| e.to_string())?;
                let n_inner = state.full_n_segments();
                let mut primera_inner = true;
                for inner_idx in 0..n_inner {
                    let segment = match state.get_segment(inner_idx) {
                        Some(s) => s,
                        None => continue,
                    };
                    let n_toks = segment.n_tokens();
                    let mut primer_token = true;
                    for tok_idx in 0..n_toks {
                        let token = match segment.get_token(tok_idx) {
                            Some(t) => t,
                            None => continue,
                        };
                        let texto = token.to_str_lossy().unwrap_or_default().to_string();
                        let trimmed = texto.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        if trimmed.starts_with('[') && trimmed.ends_with(']') {
                            continue;
                        }
                        let data = token.token_data();
                        if data.t0 < 0 || data.t1 < 0 {
                            continue;
                        }
                        raw_tokens.push(RawToken {
                            texto,
                            inicio: data.t0 as f64 / 100.0 + offset_s,
                            fin: data.t1 as f64 / 100.0 + offset_s,
                            es_inicio_segmento: if primera_inner { primer_token } else { false },
                        });
                        primer_token = false;
                    }
                    if primera_inner && n_toks == 0 {
                        // Fallback: usar texto del segmento
                        let texto = segment.to_str_lossy().unwrap_or_default().to_string();
                        let texto = texto.trim().to_string();
                        if !texto.is_empty() && !(texto.starts_with('[') && texto.ends_with(']')) {
                            raw_tokens.push(RawToken {
                                texto: format!(" {}", texto),
                                inicio: segment.start_timestamp() as f64 / 100.0 + offset_s,
                                fin: segment.end_timestamp() as f64 / 100.0 + offset_s,
                                es_inicio_segmento: true,
                            });
                        }
                    }
                    primera_inner = false;
                }
                println!(
                    "[VAD] seg[{}] {:.2}s-{:.2}s -> {} tokens",
                    seg_idx,
                    offset_s,
                    end_idx as f64 / 16000.0,
                    raw_tokens.len()
                );
            }
        }

        println!("[POST] raw_tokens={}", raw_tokens.len());

        // 3. Diarización (antes del formatter, para split por hablante a nivel token).
        // pyannote es Python externo con fallback a polyvoice nativo (best-effort igual
        // que antes: si falla, se sigue sin speakers en vez de romper la transcripción).
        let usar_pyannote = diarizador.as_deref() == Some("pyannote");
        let mut speaker_index: Option<Vec<(f64, f64, String)>> = None;
        if usar_pyannote {
            match diarizar_pyannote(&audio) {
                Ok(idx) => {
                    println!("[DIAR] Diarización pyannote completada, {} turns", idx.len());
                    speaker_index = Some(idx);
                }
                Err(e) => {
                    println!("[DIAR] pyannote falló ({}), fallback a polyvoice", e);
                    emit_progreso("diarizando", 90, "Pyannote no disponible, usando polyvoice...");
                }
            }
        }
        if speaker_index.is_none() {
            emit_progreso("diarizando", 90, "Identificando hablantes con polyvoice...");
            match diarizar_get_turns(&audio, max_speakers) {
                Ok(t) => {
                    println!("[DIAR] Diarización completada, {} turns", t.len());
                    speaker_index = Some(indice_turns(&t));
                }
                Err(e) => {
                    println!("[DIAR] Error (no crítica): {}, omitiendo speakers", e);
                }
            }
        }
        let token_speakers: Vec<Option<String>> = if let Some(ref index) = speaker_index {
            raw_tokens.iter()
                .map(|t| find_speaker_for_time(t.inicio, index).map(|s| s.to_string()))
                .collect()
        } else {
            vec![None; raw_tokens.len()]
        };

        // Filtro: solo cambios de speaker que persisten ≥3 tokens (evita ruido por solapamiento)
        // y solo en limites de palabra (no partir BPE continuations)
        let mut stable_change = vec![false; token_speakers.len()];
        if token_speakers.len() > 1 {
            let mut i = 1;
            while i < token_speakers.len() {
                if token_speakers[i] != token_speakers[i - 1] && token_speakers[i].is_some() {
                    let new_sp = &token_speakers[i];
                    let mut j = i;
                    while j + 1 < token_speakers.len() && token_speakers[j + 1].as_ref() == new_sp.as_ref() {
                        j += 1;
                    }
                    if j - i >= 2 && raw_tokens[i].texto.starts_with(' ') {
                        stable_change[i] = true;
                    }
                    i = j + 1;
                } else {
                    i += 1;
                }
            }
        }

        // 2. Convert raw tokens to WordInput, insertando segment_break en cambios de hablante
        emit_progreso("formateando", 95, "Formateando subtítulos...");
        let words: Vec<postprocess::WordInput> = raw_tokens
            .into_iter()
            .enumerate()
            .map(|(i, t)| {
                postprocess::WordInput {
                    text: t.texto,
                    start: t.inicio,
                    end: t.fin,
                    segment_break: t.es_inicio_segmento || stable_change[i],
                }
            })
            .collect();

        let cfg = postprocess::PostProcessConfig::default();
        let cues = postprocess::process_segments(words, &cfg);

        println!("[POST] formatter devolvió {} cues", cues.len());
        emit_progreso(
            "completado",
            100,
            &format!("{} subtítulos generados", cues.len()),
        );
        for (i, c) in cues.iter().enumerate() {
            let sp = speaker_index
                .as_ref()
                .and_then(|idx| find_speaker_for_time(c.start, idx));
            println!("[POST]   [{}] {:.3}-{:.3} '{}' speaker={:?}", i, c.start, c.end, c.text, sp);
        }

        let con_speakers: Vec<SegmentoTranscrito> = cues
            .into_iter()
            .map(|c| SegmentoTranscrito {
                inicio: c.start,
                fin: c.end,
                texto: c.text,
                speaker_id: speaker_index
                    .as_ref()
                    .and_then(|idx| find_speaker_for_time(c.start, idx))
                    .map(|s| s.to_string()),
            })
            .filter(|s| s.fin > s.inicio)
            .collect();

        println!("[DIAR] Diarización integrada completada para {} segmentos", con_speakers.len());
        Ok(con_speakers)
    })();
    let _ = tx.send(result);
})
.map_err(|e| format!("Error al crear thread de transcripción: {}", e))?;
rx.await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn descargar_modelo(app: tauri::AppHandle, id: String) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let info = MODELOS_DISPONIBLES
        .iter()
        .find(|m| m.id == id)
        .ok_or("Modelo desconocido")?;
    let url = format!(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
        info.archivo
    );
    let destino = ruta_modelo_por_id(&app, &id)?;
    // .part único por proceso: dos descargas concurrentes no se pisan el archivo
    let destino_part = destino.with_extension(format!("part-{}", std::process::id()));

    let respuesta = reqwest::get(&url).await.map_err(|e| e.to_string())?;
    if !respuesta.status().is_success() {
        return Err(format!(
            "No se pudo descargar el modelo (HTTP {})",
            respuesta.status()
        ));
    }
    let total: u64 = respuesta.content_length().unwrap_or(0);

    let mut archivo = tokio::fs::File::create(&destino_part)
        .await
        .map_err(|e| e.to_string())?;
    let mut descargado: u64 = 0;
    let mut stream = respuesta.bytes_stream();

    {
        let _ = app.emit(
            "modelo_descarga_progreso",
            serde_json::json!({
                "id": id,
                "progreso": 0.0,
                "bytes_descargados": 0u64,
                "bytes_total": total,
                "estado": "descargando",
            }),
        );
    }

    let mut last_emit = std::time::Instant::now();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        archivo.write_all(&chunk).await.map_err(|e| e.to_string())?;
        descargado += chunk.len() as u64;

        if last_emit.elapsed().as_millis() >= 150 {
            last_emit = std::time::Instant::now();
            let progreso = if total > 0 {
                descargado as f64 / total as f64
            } else {
                0.0
            };
            let _ = app.emit(
                "modelo_descarga_progreso",
                serde_json::json!({
                    "id": id,
                    "progreso": progreso,
                    "bytes_descargados": descargado,
                    "bytes_total": total,
                    "estado": "descargando",
                }),
            );
        }
    }

    archivo.flush().await.map_err(|e| e.to_string())?;
    drop(archivo);

    // Descarga incompleta (conexión cortada "limpiamente"): no marcar como
    // descargado un modelo truncado.
    if total > 0 && descargado != total {
        let _ = tokio::fs::remove_file(&destino_part).await;
        return Err(format!(
            "Descarga incompleta ({} de {} bytes), reintenta",
            descargado, total
        ));
    }

    // Renombrar .part -> archivo final. En Windows el rename reemplaza el
    // destino existente (MOVEFILE_REPLACE_EXISTING): no hay ventana en la que
    // el modelo previo desaparezca. Solo tras el éxito se emite "completo".
    tokio::fs::rename(&destino_part, &destino).await.map_err(|e| {
        let _ = tokio::fs::remove_file(&destino_part);
        format!("Error finalizando descarga: {}", e)
    })?;

    let _ = app.emit(
        "modelo_descarga_progreso",
        serde_json::json!({
            "id": id,
            "progreso": 1.0,
            "bytes_descargados": descargado,
            "bytes_total": total,
            "estado": "completo",
        }),
    );

    Ok(())
}

#[tauri::command]
fn guardar_proyecto(ruta: String, proyecto: Proyecto) -> Result<(), String> {
    let json = serde_json::to_string_pretty(&proyecto).map_err(|e| e.to_string())?;
    escribir_atomico(std::path::Path::new(&ruta), json.as_bytes())
}

#[tauri::command]
fn cargar_proyecto(ruta: String) -> Result<Proyecto, String> {
    let contenido = std::fs::read_to_string(&ruta).map_err(|e| e.to_string())?;
    let proyecto: Proyecto = serde_json::from_str(&contenido).map_err(|e| e.to_string())?;
    Ok(proyecto)
}

#[tauri::command]
fn existe_archivo(ruta: String) -> bool {
    std::path::Path::new(&ruta).exists()
}

#[tauri::command]
fn leer_archivo_texto(ruta: String) -> Result<String, String> {
    std::fs::read_to_string(&ruta).map_err(|e| e.to_string())
}

#[tauri::command]
fn verificar_ffmpeg() -> bool {
    std::process::Command::new("ffmpeg")
        .arg("-version")
        .output()
        .is_ok()
}

#[derive(Serialize)]
struct PyannoteInfo {
    disponible: bool,
    version: Option<String>,
}

// Busca un python con pyannote.audio instalado (devuelve programa, args base y versión).
// El diarizador pyannote es Python externo (como ffmpeg): la app lo verifica y lo
// invoca por CLI, nunca se empaqueta dentro del binario.
fn python_con_pyannote() -> Result<(String, Vec<String>, String), String> {
    const CANDIDATOS: &[&[&str]] = &[&["python"], &["python3"], &["py", "-3"]];
    for cand in CANDIDATOS {
        let out = std::process::Command::new(cand[0])
            .args(&cand[1..])
            .arg("-c")
            .arg("import pyannote.audio; print(pyannote.audio.__version__)")
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let version = String::from_utf8_lossy(&o.stdout).trim().to_string();
                return Ok((
                    cand[0].to_string(),
                    cand[1..].iter().map(|s| s.to_string()).collect(),
                    version,
                ));
            }
        }
    }
    Err("pyannote.audio no encontrado (instala Python con: pip install pyannote.audio soundfile)".to_string())
}

#[tauri::command]
fn verificar_pyannote() -> PyannoteInfo {
    match python_con_pyannote() {
        Ok((_, _, version)) => PyannoteInfo { disponible: true, version: Some(version) },
        Err(_) => PyannoteInfo { disponible: false, version: None },
    }
}

// Escribe PCM16 mono 16k con header WAV mínimo (sin deps: hound se quitó del repo).
fn escribir_wav_mono_16k(ruta: &std::path::Path, muestras: &[f32]) -> Result<(), String> {
    let mut bytes = Vec::with_capacity(44 + muestras.len() * 2);
    let n = muestras.len() as u32;
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + n * 2).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&16000u32.to_le_bytes());
    bytes.extend_from_slice(&32000u32.to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(n * 2).to_le_bytes());
    for m in muestras {
        let v = (m.clamp(-1.0, 1.0) * 32767.0) as i16;
        bytes.extend_from_slice(&v.to_le_bytes());
    }
    escribir_atomico(ruta, &bytes)
}

// Diariza con pyannote community-1 vía el script empaquetado (include_str!:
// viaja dentro del binario, se vuelca a temp en cada uso — sin config de
// bundle resources). Devuelve el índice (inicio, fin, speaker) ya ordenado,
// listo para find_speaker_for_time. El audio ya viene en f32 16k mono.
fn diarizar_pyannote(audio: &[f32]) -> Result<Vec<(f64, f64, String)>, String> {
    let (prog, base_args, _) = python_con_pyannote()?;
    let tag = format!(
        "colordubber-diar-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let dir = std::env::temp_dir();
    let script = dir.join(format!("{}.py", tag));
    let wav = dir.join(format!("{}.wav", tag));
    let salida = dir.join(format!("{}.json", tag));
    escribir_atomico(&script, include_str!("../resources/diarizar_pyannote.py").as_bytes())?;
    escribir_wav_mono_16k(&wav, audio)?;
    let resultado = (|| -> Result<Vec<(f64, f64, String)>, String> {
        let out = std::process::Command::new(&prog)
            .args(&base_args)
            .arg(&script)
            .arg("--wav")
            .arg(&wav)
            .arg("--out")
            .arg(&salida)
            .output()
            .map_err(|e| format!("spawn python: {}", e))?;
        if !out.status.success() {
            return Err(format!(
                "pyannote falló: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
        let texto = std::fs::read_to_string(&salida).map_err(|e| e.to_string())?;
        let v: serde_json::Value =
            serde_json::from_str(&texto).map_err(|e| format!("JSON turns: {}", e))?;
        let mut idx: Vec<(f64, f64, String)> = v
            .get("turns")
            .and_then(|t| t.as_array())
            .ok_or("turns ausente")?
            .iter()
            .filter_map(|t| {
                Some((
                    t.get("inicio")?.as_f64()?,
                    t.get("fin")?.as_f64()?,
                    t.get("speaker")?.as_str()?.to_string(),
                ))
            })
            .collect();
        idx.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        Ok(idx)
    })();
    let _ = std::fs::remove_file(&script);
    let _ = std::fs::remove_file(&wav);
    let _ = std::fs::remove_file(&salida);
    let idx = resultado?;
    println!("[DIAR] pyannote: {} turns", idx.len());
    Ok(idx)
}

fn ruta_glosario_global(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    Ok(dir.join("glosario_global.txt"))
}

#[tauri::command]
fn cargar_glosario_global(app: tauri::AppHandle) -> Result<String, String> {
    let path = ruta_glosario_global(&app)?;
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn guardar_glosario_global(app: tauri::AppHandle, texto: String) -> Result<(), String> {
    let path = ruta_glosario_global(&app)?;
    escribir_atomico(&path, texto.as_bytes())
}

#[tauri::command]
async fn analizar_volumen(
    app: tauri::AppHandle,
    ruta: String,
    track_index: Option<usize>,
) -> Result<Vec<f32>, String> {
    let idx = track_index.unwrap_or(0);
    {
        let mut set = ANALIZANDO
            .lock()
            .map_err(|_| "Error interno de análisis".to_string())?;
        if !set.insert((ruta.clone(), idx)) {
            return Err("Ya se está analizando este video/track".to_string());
        }
    }
    let _guard = AnalisisGuard {
        ruta: ruta.clone(),
        idx,
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<Vec<f32>, String> {
        use std::time::Instant;
        use symphonia::core::audio::SampleBuffer;
        use symphonia::core::codecs::DecoderOptions;
        use symphonia::core::errors::Error as SymphoniaError;
        use symphonia::core::formats::FormatOptions;
        use symphonia::core::io::MediaSourceStream;
        use symphonia::core::meta::MetadataOptions;
        use symphonia::core::probe::Hint;

        let file = std::fs::File::open(&ruta).map_err(|e| e.to_string())?;
        let mss = MediaSourceStream::new(Box::new(file), Default::default());

        let mut hint = Hint::new();
        if let Some(ext) = std::path::Path::new(&ruta)
            .extension()
            .and_then(|e| e.to_str())
        {
            hint.with_extension(ext);
        }

        let probed = symphonia::default::get_probe()
            .format(
                &hint,
                mss,
                &FormatOptions::default(),
                &MetadataOptions::default(),
            )
            .map_err(|e| e.to_string())?;

        let mut format = probed.format;

        let idx = track_index.unwrap_or(0);
        println!(
            "[WAVEFORM] track_index recibido={:?}, idx usado={}",
            track_index, idx
        );
        let track = format
            .tracks()
            .iter()
            .filter(|t| t.codec_params.sample_rate.is_some())
            .nth(idx)
            .ok_or("No se encontró el track de audio solicitado")?
            .clone();

        let track_id = track.id;
        println!(
            "[WAVEFORM] Decodificando symphonia stream_id={}, track_id={}",
            track_id, idx
        );
        let sample_rate = track.codec_params.sample_rate.ok_or("Sin sample rate")? as f64;

        let mut decoder = symphonia::default::get_codecs()
            .make(&track.codec_params, &DecoderOptions::default())
            .map_err(|e| e.to_string())?;

        let mut resultados: Vec<f32> = Vec::new();
        let mut acumulador_cuadrados: f64 = 0.0;
        let mut acumulador_cuenta: usize = 0;
        let mut sample_buf: Option<SampleBuffer<f32>> = None;
        let mut ventana_samples: usize = 0;
        let mut ultimo_emit = Instant::now();
        let mut ultimo_flush_idx: usize = 0;

        loop {
            let packet = match format.next_packet() {
                Ok(p) => p,
                Err(SymphoniaError::IoError(_)) => break,
                Err(e) => return Err(e.to_string()),
            };

            if packet.track_id() != track_id {
                continue;
            }

            let decoded = match decoder.decode(&packet) {
                Ok(d) => d,
                Err(SymphoniaError::DecodeError(_)) => continue,
                Err(e) => return Err(e.to_string()),
            };

            if sample_buf.is_none() {
                let spec = *decoded.spec();
                let duration = decoded.capacity() as u64;
                let channels = spec.channels.count();
                ventana_samples = ((sample_rate / 15.0).round() as usize) * channels;
                sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
            }

            let buf = sample_buf.as_mut().unwrap();
            buf.copy_interleaved_ref(decoded);
            let samples = buf.samples();

            for &s in samples {
                acumulador_cuadrados += (s as f64) * (s as f64);
                acumulador_cuenta += 1;

                if acumulador_cuenta >= ventana_samples {
                    let rms = (acumulador_cuadrados / acumulador_cuenta as f64).sqrt();
                    resultados.push(rms as f32);
                    acumulador_cuadrados = 0.0;
                    acumulador_cuenta = 0;
                }
            }

            if ultimo_emit.elapsed().as_millis() > 250 {
                if ultimo_flush_idx < resultados.len() {
                    let nuevo_chunk = resultados[ultimo_flush_idx..].to_vec();
                    let _ = app.emit("volumen_chunk", (track_index, nuevo_chunk));
                    ultimo_flush_idx = resultados.len();
                }
                ultimo_emit = Instant::now();
            }
        }

        if ultimo_flush_idx < resultados.len() {
            let nuevo_chunk = resultados[ultimo_flush_idx..].to_vec();
            let _ = app.emit("volumen_chunk", (track_index, nuevo_chunk));
        }
        let _ = guardar_cache_volumen(&app, &ruta, track_index, &resultados);

        Ok(resultados)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn eliminar_modelo(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = ruta_modelo_por_id(&app, &id)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn extraer_audio_stream(
    app: tauri::AppHandle,
    ruta_video: String,
    audio_track_index: usize,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        use std::process::Command;

        let cache_key = calcular_cache_key(&ruta_video)?;
        let temp_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
        let output_file = temp_dir.join(format!("audio_v2_{}_{}.m4a", cache_key, audio_track_index));
        // Se escribe a un .part y se renombra al final: un crash de ffmpeg a
        // mitad nunca deja un cache truncado que parezca válido para siempre.
        let output_part = output_file.with_extension("part");

        if output_file.exists() {
            println!(
                "[AUDIO_EXTRACT] Cache HIT para track={}, archivo={:?}",
                audio_track_index, output_file
            );
            return Ok(output_file.to_string_lossy().to_string());
        }

        println!(
            "[AUDIO_EXTRACT] ffmpeg -i \"{}\" -vn -c:a copy -map 0:a:{} -movflags +faststart -y \"{}\"",
            ruta_video, audio_track_index, output_part.display()
        );

        let map_arg = format!("0:a:{}", audio_track_index);
        // -f mp4 explícito: el muxer se elige por la extensión del archivo y
        // ".part" no la tiene (ffmpeg 9 falla con "Unable to choose an output
        // format"). El rename final a .m4a preserva el formato.
        let mut output = Command::new("ffmpeg")
            .args([
                "-i",
                &ruta_video,
                "-vn",
                "-c:a",
                "copy",
                "-map",
                &map_arg,
                "-movflags",
                "+faststart",
                "-f",
                "mp4",
                "-y",
                output_part.to_str().ok_or("Ruta de salida inválida")?,
            ])
            .output()
            .map_err(|e| format!("Error ejecutando ffmpeg: {}", e))?;

        if !output.status.success() {
            // Codec no soportado en contenedor destino: reintentar transcode a AAC
            println!(
                "[AUDIO_EXTRACT] copy falló ({}), reintentando con AAC...",
                String::from_utf8_lossy(&output.stderr).lines().next().unwrap_or("")
            );
            let _ = std::fs::remove_file(&output_part);
            output = Command::new("ffmpeg")
                .args([
                    "-i",
                    &ruta_video,
                    "-vn",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    "-map",
                    &map_arg,
                    "-movflags",
                    "+faststart",
                    "-f",
                    "mp4",
                    "-y",
                    output_part.to_str().ok_or("Ruta de salida inválida")?,
                ])
                .output()
                .map_err(|e| format!("Error ejecutando ffmpeg: {}", e))?;
            if !output.status.success() {
                let _ = std::fs::remove_file(&output_part);
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("FFmpeg falló (copy y AAC): {}", stderr));
            }
        }

        std::fs::rename(&output_part, &output_file).map_err(|e| {
            let _ = std::fs::remove_file(&output_part);
            format!("Error finalizando extracción: {}", e)
        })?;

        Ok(output_file.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn escribir_archivo_texto(ruta: String, contenido: String) -> Result<(), String> {
    escribir_atomico(std::path::Path::new(&ruta), contenido.as_bytes())
}

#[tauri::command]
fn escribir_archivo_en_carpeta(
    carpeta: String,
    nombre_archivo: String,
    contenido: String,
) -> Result<(), String> {
    let ruta = std::path::Path::new(&carpeta).join(&nombre_archivo);
    escribir_atomico(&ruta, contenido.as_bytes())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            guardar_proyecto,
            cargar_proyecto,
            existe_archivo,
            analizar_volumen,
            leer_archivo_texto,
            escribir_archivo_texto,
            escribir_archivo_en_carpeta,
            existe_cache_volumen,
            cargar_cache_volumen,
            listar_modelos,
            descargar_modelo,
            eliminar_modelo,
            transcribir_video,
            listar_tracks_audio,
            extraer_audio_stream,
            cargar_glosario_global,
            guardar_glosario_global,
            verificar_ffmpeg,
            verificar_pyannote,
        ])
        .setup(|app| {
            let nuevo = MenuItemBuilder::new("Nuevo proyecto")
                .id("nuevo_proyecto")
                .build(app)?;
            let abrir = MenuItemBuilder::new("Abrir proyecto")
                .id("abrir_proyecto")
                .build(app)?;
            let guardar = MenuItemBuilder::new("Guardar proyecto")
                .id("guardar_proyecto")
                .build(app)?;
            let guardar_como = MenuItemBuilder::new("Guardar como...")
                .id("guardar_como")
                .build(app)?;
            let abrir_video = MenuItemBuilder::new("Abrir video")
                .id("abrir_video")
                .build(app)?;
            let cargar_srt = MenuItemBuilder::new("Cargar SRT")
                .id("cargar_srt")
                .build(app)?;
            let importar_autosubs = MenuItemBuilder::new("Importar auto-subs (SRT+TXT)")
                .id("importar_autosubs")
                .build(app)?;

            let menu_archivo = SubmenuBuilder::new(app, "Archivo")
                .item(&nuevo)
                .item(&abrir)
                .item(&guardar)
                .item(&guardar_como)
                .separator()
                .item(&abrir_video)
                .item(&cargar_srt)
                .item(&importar_autosubs)
                .build()?;

            let exportar_srt = MenuItemBuilder::new("Exportar SRT por hablante")
                .id("exportar_srt_hablantes")
                .build(app)?;
            let exportar_json = MenuItemBuilder::new("Exportar JSON combinado")
                .id("exportar_json")
                .build(app)?;

            let menu_exportar = SubmenuBuilder::new(app, "Exportar")
                .item(&exportar_srt)
                .item(&exportar_json)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&menu_archivo)
                .item(&menu_exportar)
                .build()?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit(event.id().as_ref(), ());
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
