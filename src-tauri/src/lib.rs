use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::Emitter;
use tauri::Manager;

// Guard de concurrencia: evita dos análisis de volumen del mismo track
// emitiendo chunks duplicados al frontend.
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
            listar_tracks_audio,
            extraer_audio_stream,
            cargar_glosario_global,
            guardar_glosario_global,
            verificar_ffmpeg,
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
