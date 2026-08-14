use std::time::Instant;

use polyvoice::pipeline_v2::{ClustererKind, Pipeline, PipelineConfig};
use polyvoice::types::SampleRate;
use serde::Deserialize;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Deserialize)]
struct GroundTruthEntry {
    inicio: String,
    fin: String,
    texto: String,
    #[allow(dead_code)]
    hablante: String,
}

#[derive(Clone)]
struct GroundTruthSegment {
    start: f64,
    end: f64,
    text: String,
    speaker: String,
}

fn parse_srt_time(t: &str) -> f64 {
    let t = t.trim().replace(',', ".");
    let parts: Vec<&str> = t.split(':').collect();
    if parts.len() == 3 {
        let h: f64 = parts[0].parse().unwrap_or(0.0);
        let m: f64 = parts[1].parse().unwrap_or(0.0);
        let s: f64 = parts[2].parse().unwrap_or(0.0);
        h * 3600.0 + m * 60.0 + s
    } else {
        0.0
    }
}

fn load_ground_truth(path: &str) -> Result<Vec<GroundTruthSegment>, String> {
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        // Load all .srt files from directory
        let mut all_segments = Vec::new();
        let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let fname = entry.file_name().to_string_lossy().to_string();
            if !fname.ends_with(".srt") { continue; }
            let speaker = fname.trim_end_matches(".srt").to_string();
            let filepath = entry.path();
            let srt_content = std::fs::read_to_string(&filepath).map_err(|e| e.to_string())?;
            let segs = parse_srt_content(&srt_content, &speaker)?;
            println!("  Cargado SRT: {} -> {} segmentos para '{}'", fname, segs.len(), speaker);
            all_segments.extend(segs);
        }
        if all_segments.is_empty() {
            return Err("No se encontraron archivos .srt en el directorio".to_string());
        }
        all_segments.sort_by(|a, b| a.start.partial_cmp(&b.start).unwrap_or(std::cmp::Ordering::Equal));
        Ok(all_segments)
    } else {
        // Legacy: single JSON file
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let entries: Vec<GroundTruthEntry> =
            serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let segments: Vec<GroundTruthSegment> = entries
            .into_iter()
            .map(|e| GroundTruthSegment {
                start: parse_srt_time(&e.inicio),
                end: parse_srt_time(&e.fin),
                text: e.texto,
                speaker: e.hablante,
            })
            .collect();
        Ok(segments)
    }
}

fn parse_srt_content(content: &str, default_speaker: &str) -> Result<Vec<GroundTruthSegment>, String> {
    let mut segments = Vec::new();
    let mut lines = content.lines().peekable();
    while lines.peek().is_some() {
        // Skip empty lines
        while let Some(l) = lines.peek() {
            if l.trim().is_empty() { lines.next(); } else { break; }
        }
        if lines.peek().is_none() { break; }
        // Sequence number
        lines.next();
        // Timecode line
        let tc_line = match lines.next() {
            Some(l) => l.trim().to_string(),
            None => break,
        };
        let tc_parts: Vec<&str> = tc_line.split("-->").collect();
        if tc_parts.len() != 2 { continue; }
        let start = parse_srt_time(tc_parts[0].trim());
        let end = parse_srt_time(tc_parts[1].trim());
        // Skip blank lines before text
        while let Some(l) = lines.peek() {
            if l.trim().is_empty() { lines.next(); } else { break; }
        }
        // Text lines (until blank line or end)
        let mut text = String::new();
        while let Some(l) = lines.peek() {
            if l.trim().is_empty() { break; }
            if !text.is_empty() { text.push(' '); }
            text.push_str(l.trim());
            lines.next();
        }
        if !text.is_empty() {
            segments.push(GroundTruthSegment { start, end, text, speaker: default_speaker.to_string() });
        }
    }
    Ok(segments)
}

fn decode_audio_16k(path: &str) -> Result<Vec<f32>, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::errors::Error as SymphoniaError;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
    {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| e.to_string())?;
    let mut format = probed.format;
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.sample_rate.is_some())
        .ok_or("No audio track found")?
        .clone();
    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.ok_or("No sample rate")? as f64;
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;
    let mut all_samples: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;
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
            sample_buf = Some(SampleBuffer::<f32>::new(duration, spec));
        }
        let buf = sample_buf.as_mut().unwrap();
        buf.copy_interleaved_ref(decoded);
        all_samples.extend_from_slice(buf.samples());
    }
    if (sample_rate - 16000.0).abs() > 1.0 {
        let ratio = 16000.0 / sample_rate;
        let new_len = (all_samples.len() as f64 * ratio) as usize;
        let mut resampled = Vec::with_capacity(new_len);
        for i in 0..new_len {
            let src_idx = (i as f64 / ratio) as usize;
            let src_idx = src_idx.min(all_samples.len().saturating_sub(1));
            resampled.push(all_samples[src_idx]);
        }
        Ok(resampled)
    } else {
        Ok(all_samples)
    }
}

fn compute_cer(reference: &str, hypothesis: &str) -> f64 {
    let ref_chars: Vec<char> = reference.chars().collect();
    let hyp_chars: Vec<char> = hypothesis.chars().collect();
    let n = ref_chars.len();
    let m = hyp_chars.len();
    let mut dp = vec![vec![0usize; m + 1]; n + 1];
    for i in 0..=n { dp[i][0] = i; }
    for j in 0..=m { dp[0][j] = j; }
    for i in 1..=n {
        for j in 1..=m {
            let cost = if ref_chars[i - 1] == hyp_chars[j - 1] { 0 } else { 1 };
            dp[i][j] = (dp[i - 1][j] + 1)
                .min(dp[i][j - 1] + 1)
                .min(dp[i - 1][j - 1] + cost);
        }
    }
    let edits = dp[n][m];
    let max_len = n.max(m).max(1);
    edits as f64 / max_len as f64
}

fn transcribe_whisper(
    audio: &[f32],
    model_path: &str,
    use_beam_search: bool,
    prompt: Option<&str>,
) -> Result<Vec<(f64, f64, String)>, String> {
    whisper_rs::install_logging_hooks();
    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .map_err(|e| e.to_string())?;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let mut params = if use_beam_search {
        FullParams::new(SamplingStrategy::BeamSearch { beam_size: 5, patience: -1.0 })
    } else {
        FullParams::new(SamplingStrategy::Greedy { best_of: 1 })
    };
    params.set_language(Some("es"));
    params.set_suppress_blank(true);
    params.set_no_speech_thold(0.4);
    params.set_token_timestamps(true);
    params.set_split_on_word(true);
    params.set_max_len(42);
    params.set_single_segment(false);
    if let Some(p) = prompt {
        if !p.trim().is_empty() {
            params.set_initial_prompt(p);
        }
    }
    state.full(params, audio).map_err(|e| e.to_string())?;
    let n_segs = state.full_n_segments();
    let mut segments = Vec::new();
    for i in 0..n_segs {
        let seg = state.get_segment(i).ok_or("No segment")?;
        let text = seg.to_str().unwrap_or_default().trim().to_string();
        if text.is_empty() { continue; }
        let start = seg.start_timestamp() as f64 / 100.0;
        let end = seg.end_timestamp() as f64 / 100.0;
        segments.push((start, end, text));
    }
    Ok(segments)
}

fn extract_text_in_range(
    segments: &[(f64, f64, String)],
    start: f64,
    end: f64,
) -> Vec<String> {
    segments
        .iter()
        .filter(|(s, e, _)| *s < end && *e > start)
        .map(|(_, _, t)| t.clone())
        .collect()
}

fn score_against_ground_truth_diarization(
    turns: &[polyvoice::SpeakerTurn],
    ground_truth: &[GroundTruthSegment],
    total_duration: f64,
) -> f64 {
    if turns.is_empty() || ground_truth.is_empty() {
        return 0.0;
    }
    let step = 0.1;
    let num_steps = (total_duration / step).ceil() as usize;
    let mut gt_speakers: Vec<Option<String>> = Vec::with_capacity(num_steps);
    let mut pred_speakers: Vec<Option<String>> = Vec::with_capacity(num_steps);
    for i in 0..num_steps {
        let t = i as f64 * step;
        let gt = ground_truth
            .iter()
            .find(|s| t >= s.start && t < s.end)
            .map(|s| s.speaker.clone());
        gt_speakers.push(gt);
        let pred = turns
            .iter()
            .find(|turn| t >= turn.time.start && t < turn.time.end)
            .map(|turn| format!("{:?}", turn.speaker));
        pred_speakers.push(pred);
    }
    use std::collections::HashMap;
    let mut pred_to_gt_counts: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for i in 0..num_steps {
        if let (Some(pred), Some(gt)) = (&pred_speakers[i], &gt_speakers[i]) {
            pred_to_gt_counts
                .entry(pred.clone())
                .or_default()
                .entry(gt.clone())
                .and_modify(|c| *c += 1)
                .or_insert(1);
        }
    }
    let mut mapping: HashMap<String, String> = HashMap::new();
    for (pred, gt_counts) in &pred_to_gt_counts {
        if let Some((best_gt, _)) = gt_counts.iter().max_by_key(|(_, c)| *c) {
            mapping.insert(pred.clone(), best_gt.clone());
        }
    }
    let mut correct = 0usize;
    let mut total = 0usize;
    for i in 0..num_steps {
        if let (Some(pred), Some(gt)) = (&pred_speakers[i], &gt_speakers[i]) {
            total += 1;
            if mapping.get(pred).map_or(false, |m| m == gt) {
                correct += 1;
            }
        }
    }
    if total == 0 { return 0.0; }
    correct as f64 / total as f64
}

fn run_diarization(
    audio: &[f32],
    sr: SampleRate,
    config: PipelineConfig,
) -> Result<Vec<polyvoice::SpeakerTurn>, String> {
    let pipeline = Pipeline::builder()
        .config(config)
        .with_models_from(
            polyvoice::models::ModelRegistry::default()
                .map_err(|e| format!("ModelRegistry: {}", e))?,
        )
        .build()
        .map_err(|e| format!("Pipeline build: {:?}", e))?;
    let result = pipeline.run(audio, sr).map_err(|e| format!("Run: {:?}", e))?;
    Ok(result.turns)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("Uso: cargo run --bin calibrar <video.mp4> [ground_truth.json|auto] <whisper_model.bin>");
        eprintln!("  Si el segundo argumento es 'auto', se omite la calibración y solo se ejecuta el pipeline completo");
        eprintln!("  El modelo whisper debe estar descargado (large-v3-turbo recomendado)");
        std::process::exit(1);
    }
    let video_path = &args[1];
    let model_path = &args[args.len() - 1];
    let is_judge_mode = args.len() == 3 || args[2] == "auto";

    if is_judge_mode {
        println!("=== Pipeline completa (modo auto) ===");
        println!("Video: {}", video_path);
        run_pipeline_only(video_path, model_path);
        return;
    }

    let gt_path = &args[2];
    let ground_truth = load_ground_truth(gt_path).expect("Failed to load ground truth");
    let total_duration = ground_truth
        .iter()
        .map(|s| s.end)
        .max_by(|a, b| a.partial_cmp(b).unwrap())
        .unwrap_or(0.0);

    println!("=== Calibración completa ===");
    println!("Video: {}", video_path);
    println!("Ground truth: {} segmentos, {:.1}s", ground_truth.len(), total_duration);

    let speaker_counts = {
        let mut counts: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
        for s in &ground_truth {
            *counts.entry(s.speaker.as_str()).or_insert(0) += 1;
        }
        counts
    };
    for (sp, count) in &speaker_counts {
        println!("  Speaker {}: {} segmentos", sp, count);
    }

    println!("\nDecodificando audio...");
    let decode_start = Instant::now();
    let audio = decode_audio_16k(video_path).expect("Failed to decode audio");
    let audio_secs = audio.len() as f64 / 16000.0;
    println!("Audio: {:.1}s, {:.1}s decode", audio_secs, decode_start.elapsed().as_secs_f32());

    // ====== WHISPER CALIBRATION ======
    println!("\n{}", "=".repeat(60));
    println!("CALIBRACIÓN WHISPER");
    println!("{}", "=".repeat(60));

    let whisper_configs: Vec<(&str, bool, Option<&str>)> = vec![
        ("Greedy best_of=1", false, None),
        ("BeamSearch beam=5", true, None),
        ("Greedy + glosario básico", false, Some("Nacho, Mid, Operator, GG, headshot, EZ")),
        ("BeamSearch + glosario básico", true, Some("Nacho, Mid, Operator, GG, headshot, EZ")),
    ];

    for (label, use_beam, prompt) in &whisper_configs {
        let start = Instant::now();
        match transcribe_whisper(&audio, model_path, *use_beam, *prompt) {
            Ok(segments) => {
                let elapsed = start.elapsed().as_secs_f32();
                // Compute per-GT-segment CER
                let mut total_cer = 0.0;
                let mut count = 0;
                for gt in &ground_truth {
                    let texts = extract_text_in_range(&segments, gt.start, gt.end);
                    if texts.is_empty() { continue; }
                    let hyp = texts.join(" ");
                    let cer = compute_cer(&gt.text, &hyp);
                    total_cer += cer;
                    count += 1;
                }
                let avg_cer = if count > 0 { total_cer / count as f64 } else { 1.0 };
                println!("  {:25} CER={:.4} ({:.1}s, {} segs)", label, avg_cer, elapsed, segments.len());
            }
            Err(e) => println!("  {:25} ERROR: {}", label, e),
        }
    }

    // ====== POLYVOICE DIARIZATION — BINARY SEARCH ======
    println!("\n{}", "=".repeat(60));
    println!("CALIBRACIÓN DIARIZACIÓN (búsqueda binaria)");
    println!("{}", "=".repeat(60));

    let sr = SampleRate::new(16000).expect("Invalid sample rate");

    fn test_config(
        audio: &[f32], sr: SampleRate, config: &PipelineConfig,
        gt: &[GroundTruthSegment], dur: f64,
    ) -> Option<(f64, PipelineConfig)> {
        let start = Instant::now();
        match run_diarization(audio, sr, config.clone()) {
            Ok(turns) => {
                let score = score_against_ground_truth_diarization(&turns, gt, dur);
                let elapsed = start.elapsed().as_secs_f32();
                let t = match &config.clusterer {
                    ClustererKind::Ahc { threshold } => *threshold,
                    _ => 0.0,
                };
                println!("  t={:.2} maxSp={} minCl={} gap={:.1} -> score={:.4} ({:.1}s)",
                    t, config.max_speakers, config.min_cluster_size, config.max_gap_secs, score, elapsed);
                Some((score, config.clone()))
            }
            Err(e) => {
                let t = match &config.clusterer {
                    ClustererKind::Ahc { threshold } => *threshold,
                    _ => 0.0,
                };
                println!("  t={:.2} maxSp={} minCl={} gap={:.1} -> ERROR: {}", t,
                    config.max_speakers, config.min_cluster_size, config.max_gap_secs, e);
                None
            }
        }
    }

    fn make_cfg(threshold: f32, max_speakers: u8, min_cluster_size: usize, max_gap_secs: f32) -> PipelineConfig {
        PipelineConfig {
            max_speakers: if max_speakers == 0 { 20 } else { max_speakers },
            min_cluster_size,
            max_gap_secs,
            min_speech_secs: 0.3,
            clusterer: ClustererKind::Ahc { threshold },
            ..PipelineConfig::default()
        }
    }

    // Step 1: binary search on threshold (fixed defaults for other params)
    println!("\nPaso 1: threshold (maxSp=0, minCl=1, gap=0.5)");
    let mut t_lo = 0.20f32;
    let mut t_hi = 0.60f32;
    let mut best_threshold = 0.45f32;
    let mut best_score = 0.0f64;
    let mut cache: std::collections::HashMap<u32, f64> = std::collections::HashMap::new();

    for _ in 0..6 {
        let t_mid = (t_lo + t_hi) / 2.0;
        let t_left = (t_lo + t_mid) / 2.0;
        let t_right = (t_mid + t_hi) / 2.0;

        let key_mid = (t_mid * 100.0) as u32;
        let key_left = (t_left * 100.0) as u32;
        let key_right = (t_right * 100.0) as u32;

        if !cache.contains_key(&key_mid) {
            let cfg = make_cfg(t_mid, 0, 1, 0.5);
            if let Some((s, _)) = test_config(&audio, sr, &cfg, &ground_truth, total_duration) {
                cache.insert(key_mid, s);
            }
        }
        if !cache.contains_key(&key_left) {
            let cfg = make_cfg(t_left, 0, 1, 0.5);
            if let Some((s, _)) = test_config(&audio, sr, &cfg, &ground_truth, total_duration) {
                cache.insert(key_left, s);
            }
        }
        if !cache.contains_key(&key_right) {
            let cfg = make_cfg(t_right, 0, 1, 0.5);
            if let Some((s, _)) = test_config(&audio, sr, &cfg, &ground_truth, total_duration) {
                cache.insert(key_right, s);
            }
        }

        let sm = cache.get(&key_mid).copied().unwrap_or(0.0);
        let sl = cache.get(&key_left).copied().unwrap_or(0.0);
        let sr_val = cache.get(&key_right).copied().unwrap_or(0.0);

        if sl >= sm && sl >= sr_val {
            t_hi = t_mid;
            best_threshold = t_left;
            best_score = sl;
        } else if sr_val >= sm && sr_val >= sl {
            t_lo = t_mid;
            best_threshold = t_right;
            best_score = sr_val;
        } else {
            t_lo = t_left;
            t_hi = t_right;
            best_threshold = t_mid;
            best_score = sm;
        }
    }
    println!("  → mejor threshold: {:.2} (score={:.4})", best_threshold, best_score);

    // Step 2: binary search on max_gap_secs (with best threshold)
    let best_threshold = best_threshold; // make non-mut
    println!("\nPaso 2: max_gap_secs (t={:.2}, maxSp=0, minCl=1)", best_threshold);
    let mut g_lo = 0.1f32;
    let mut g_hi = 1.5f32;
    let mut best_gap = 0.5f32;
    for _ in 0..5 {
        let g_left = (g_lo + g_hi) / 2.0;
        let g_right = (g_left + g_hi) / 2.0;
        let cfg_left = make_cfg(best_threshold, 0, 1, g_left);
        let cfg_right = make_cfg(best_threshold, 0, 1, g_right);
        let sl = test_config(&audio, sr, &cfg_left, &ground_truth, total_duration);
        let sg = test_config(&audio, sr, &cfg_right, &ground_truth, total_duration);
        let sl_score = sl.map(|(s, _)| s).unwrap_or(0.0);
        let sg_score = sg.map(|(s, _)| s).unwrap_or(0.0);
        if sl_score >= sg_score {
            g_hi = g_right;
            best_gap = g_left;
            best_score = sl_score;
        } else {
            g_lo = g_left;
            best_gap = g_right;
            best_score = sg_score;
        }
    }
    println!("  → mejor max_gap_secs: {:.1} (score={:.4})", best_gap, best_score);

    // Step 3: try a few max_speakers values with best threshold & gap
    println!("\nPaso 3: max_speakers (t={:.2}, minCl=1, gap={:.1})", best_threshold, best_gap);
    let mut best_max_sp = 0u8;
    for &ms in &[0u8, 5, 6, 8, 10] {
        let cfg = make_cfg(best_threshold, ms, 1, best_gap);
        if let Some((s, _)) = test_config(&audio, sr, &cfg, &ground_truth, total_duration) {
            if s >= best_score {
                best_score = s;
                best_max_sp = ms;
            }
        }
    }
    println!("  → mejor max_speakers: {} (score={:.4})", best_max_sp, best_score);

    // Step 4: try a few min_cluster_size values
    println!("\nPaso 4: min_cluster_size (t={:.2}, maxSp={}, gap={:.1})", best_threshold, best_max_sp, best_gap);
    for &mcs in &[1usize, 2, 3] {
        let cfg = make_cfg(best_threshold, best_max_sp, mcs, best_gap);
        if let Some((s, _)) = test_config(&audio, sr, &cfg, &ground_truth, total_duration) {
            if s > best_score {
                best_score = s;
            }
        }
    }
    let final_max_sp = best_max_sp;
    let final_gap = best_gap;
    let final_mcs = 1usize; // post-step-4 we keep min_cluster at 1 as default
    println!("\n{}", "=".repeat(60));
    println!("CONFIGURACIÓN RECOMENDADA");
    println!("{}", "=".repeat(60));
    println!("PipelineConfig {{");
    println!("    max_speakers: {},", if final_max_sp == 0 { 20 } else { final_max_sp as u8 });
    println!("    min_cluster_size: {},", final_mcs);
    println!("    max_gap_secs: {:.1}f32,", final_gap);
    println!("    min_speech_secs: 0.3f32,");
    println!("    clusterer: ClustererKind::Ahc {{ threshold: {:.2} }},", best_threshold);
    println!("    ..PipelineConfig::default()");
    println!("}};");

    // ====== FULL PIPELINE COMPARISON (post-hoc speaker splitting) ======
    println!("\n{}", "=".repeat(60));
    println!("COMPARACIÓN: segment-level vs token-level speaker splitting");
    println!("{}", "=".repeat(60));

    let prompt = Some("Nacho, Mid, Operator, GG, headshot, EZ");

    // 1. Token-level transcription (same params as app)
    println!("\nEjecutando Whisper con token timestamps (BeamSearch + glosario)...");
    let tokens = match transcribe_whisper_tokens(&audio, model_path, prompt) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("  ERROR: {}", e);
            return;
        }
    };
    println!("  {} tokens extraídos", tokens.len());

    // 2. Diarization with best config found above
    println!("Ejecutando diarización (config óptima)...");
    let best_cfg = make_cfg(best_threshold, final_max_sp, final_mcs, final_gap);
    let turns = match run_diarization(&audio, sr, best_cfg) {
        Ok(t) => {
            println!("  {} turns detectados", t.len());
            t
        }
        Err(e) => {
            eprintln!("  ERROR: {}", e);
            return;
        }
    };

    // 3. Old approach: whisper segments con speaker asignado por max overlap
    println!("\n--- Enfoque A: segment-level (old) ---");
    let old_segments = match transcribe_whisper(&audio, model_path, true, prompt) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("  ERROR: {}", e);
            return;
        }
    };
    let old_with_speakers: Vec<(f64, f64, String, Option<String>)> = old_segments.iter()
        .map(|(s, e, t)| (*s, *e, t.clone(), find_best_speaker(*s, *e, &turns)))
        .collect();
    evaluate_caption_quality(&old_with_speakers, &ground_truth, "Segment-level (old)");

    // 4. New approach: assign speaker per token, split at boundaries, group into cues
    println!("\n--- Enfoque B: token-level splitting (new) ---");
    let new_captions = split_tokens_by_speaker(&tokens, &turns);
    evaluate_caption_quality(&new_captions, &ground_truth, "Token-level (new)");

    // 5. Summary comparison
    println!("\n{}", "=".repeat(60));
    println!("RESUMEN");
    println!("{}", "=".repeat(60));
    println!("  Enfoque A (segment-level, old):  {} captions", old_with_speakers.len());
    println!("  Enfoque B (token-level, new):    {} captions", new_captions.len());
}

fn transcribe_whisper_tokens(
    audio: &[f32],
    model_path: &str,
    prompt: Option<&str>,
) -> Result<Vec<(f64, f64, String, bool)>, String> {
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};
    whisper_rs::install_logging_hooks();
    let ctx = WhisperContext::new_with_params(model_path, WhisperContextParameters::default())
        .map_err(|e| e.to_string())?;
    let mut state = ctx.create_state().map_err(|e| e.to_string())?;
    let mut params = FullParams::new(SamplingStrategy::BeamSearch { beam_size: 5, patience: -1.0 });
    params.set_language(Some("es"));
    params.set_suppress_blank(true);
    params.set_no_speech_thold(0.4);
    params.set_token_timestamps(true);
    params.set_split_on_word(true);
    params.set_max_len(42);
    params.set_single_segment(false);
    if let Some(p) = prompt {
        if !p.trim().is_empty() {
            params.set_initial_prompt(p);
        }
    }
    state.full(params, audio).map_err(|e| e.to_string())?;
    let n_segs = state.full_n_segments();
    let mut tokens = Vec::new();
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
            if trimmed.is_empty() { continue; }
            if trimmed.starts_with('[') && trimmed.ends_with(']') { continue; }
            let data = token.token_data();
            if data.t0 < 0 || data.t1 < 0 { continue; }
            tokens.push((
                data.t0 as f64 / 100.0,
                data.t1 as f64 / 100.0,
                texto,
                primer_token,
            ));
            primer_token = false;
        }
        if n_toks == 0 {
            let texto = segment.to_str_lossy().unwrap_or_default().to_string();
            let texto = texto.trim().to_string();
            if !texto.is_empty() && !(texto.starts_with('[') && texto.ends_with(']')) {
                tokens.push((
                    segment.start_timestamp() as f64 / 100.0,
                    segment.end_timestamp() as f64 / 100.0,
                    texto,
                    true,
                ));
            }
        }
    }
    Ok(tokens)
}

fn find_speaker_for_time(t: f64, turns: &[polyvoice::SpeakerTurn]) -> Option<String> {
    for turn in turns {
        if t >= turn.time.start && t < turn.time.end {
            return Some(format!("{:?}", turn.speaker));
        }
    }
    let mut best: Option<(f64, &polyvoice::SpeakerTurn)> = None;
    for turn in turns {
        let dist = if t < turn.time.start { turn.time.start - t } else { t - turn.time.end };
        if dist < 1.5 && best.map_or(true, |(d, _)| dist < d) {
            best = Some((dist, turn));
        }
    }
    best.map(|(_, t)| format!("{:?}", t.speaker))
}

fn find_best_speaker(start: f64, end: f64, turns: &[polyvoice::SpeakerTurn]) -> Option<String> {
    let mut best_overlap = 0.0f64;
    let mut best_speaker: Option<String> = None;
    for turn in turns {
        let overlap_start = start.max(turn.time.start);
        let overlap_end = end.min(turn.time.end);
        if overlap_end > overlap_start {
            let overlap = overlap_end - overlap_start;
            if overlap > best_overlap {
                best_overlap = overlap;
                best_speaker = Some(format!("{:?}", turn.speaker));
            }
        }
    }
    best_speaker
}

fn split_tokens_by_speaker(
    tokens: &[(f64, f64, String, bool)],
    turns: &[polyvoice::SpeakerTurn],
) -> Vec<(f64, f64, String, Option<String>)> {
    // Assign speaker to each token (with nearest-turn fallback)
    let token_speakers: Vec<Option<String>> = tokens.iter()
        .map(|(s, _, _, _)| find_speaker_for_time(*s, turns))
        .collect();

    // Filter: solo cambios de speaker que persisten ≥2 tokens (evita ruido por solapamiento)
    let mut speaker_change_at = vec![false; token_speakers.len()];
    let mut i = 1;
    while i < token_speakers.len() {
        if token_speakers[i] != token_speakers[i - 1] && token_speakers[i].is_some() {
            // Ver si el nuevo speaker se mantiene al menos 2 tokens
            let new_sp = &token_speakers[i];
            let mut persist = 1;
            let mut j = i;
            while j + 1 < token_speakers.len() && token_speakers[j + 1] == *new_sp {
                persist += 1;
                j += 1;
            }
            if persist >= 2 {
                speaker_change_at[i] = true;
            }
            i = j + 1;
        } else {
            i += 1;
        }
    }

    // Group consecutive tokens with same speaker into captions
    let mut captions: Vec<(f64, f64, String, Option<String>)> = Vec::new();
    let mut group_start = 0.0f64;
    let mut group_end = 0.0f64;
    let mut group_text = String::new();
    let mut group_speaker: Option<String> = None;
    let mut in_group = false;

    for (i, ((s, e, text, seg_break), speaker)) in tokens.iter().zip(token_speakers.iter()).enumerate() {
        let speaker_change = speaker_change_at[i];

        if speaker_change || *seg_break {
            if in_group {
                captions.push((group_start, group_end, group_text.trim().to_string(), group_speaker));
            }
            group_start = *s;
            group_end = *e;
            group_text = text.clone();
            group_speaker = speaker.clone();
            in_group = true;
        } else if in_group {
            group_end = *e;
            // Add space between tokens (whisper tokens don't include spaces)
            if !group_text.ends_with(' ') && !text.starts_with(' ') {
                group_text.push(' ');
            }
            group_text.push_str(text);
        } else {
            group_start = *s;
            group_end = *e;
            group_text = text.clone();
            group_speaker = speaker.clone();
            in_group = true;
        }
    }
    if in_group {
        captions.push((group_start, group_end, group_text.trim().to_string(), group_speaker));
    }

    captions
}

fn run_pipeline_only(video_path: &str, model_path: &str) {
    use polyvoice::types::SampleRate;
    let sr = SampleRate::new(16000).expect("Invalid sample rate");

    fn bytes_a_f32(bytes: &[u8]) -> Vec<f32> {
        bytes
            .chunks_exact(4)
            .map(|c| f32::from_le_bytes(<[u8; 4]>::try_from(c).unwrap()))
            .collect()
    }

    println!("\nCargando audio...");
    let audio: Vec<f32> = if video_path.ends_with(".f32") {
        let bytes = std::fs::read(video_path).expect("Failed to read f32 file");
        bytes_a_f32(&bytes)
    } else {
        decode_audio_16k(video_path).expect("Failed to decode audio")
    };
    println!("Audio: {:.1}s", audio.len() as f64 / 16000.0);

    let prompt = Some("Nacho, Mid, Operator, GG, headshot, EZ");

    // Diarization
    println!("\nEjecutando diarización (threshold=0.40, maxSp=10, gap=1.0)...");
    let cfg = PipelineConfig {
        max_speakers: 10,
        min_cluster_size: 1,
        max_gap_secs: 1.0,
        min_speech_secs: 0.3,
        clusterer: ClustererKind::Ahc { threshold: 0.40 },
        ..PipelineConfig::default()
    };
    let turns = match run_diarization(&audio, sr, cfg) {
        Ok(t) => { println!("  {} turns, {} unique speakers", t.len(),
            { let mut s = std::collections::HashSet::new(); for turn in &t { s.insert(format!("{:?}", turn.speaker)); } s.len() });
            t
        }
        Err(e) => { eprintln!("  ERROR: {}", e); return; }
    };
    for (i, turn) in turns.iter().enumerate() {
        println!("    turn[{}] speaker={:?} {:.3}s-{:.3}s", i, turn.speaker, turn.time.start, turn.time.end);
    }

    // Token-level transcription
    println!("\nEjecutando Whisper (BeamSearch + glosario)...");
    let tokens = match transcribe_whisper_tokens(&audio, model_path, prompt) {
        Ok(t) => t,
        Err(e) => { eprintln!("  ERROR: {}", e); return; }
    };
    println!("  {} tokens extraídos", tokens.len());

    // Old approach (segment-level)
    println!("\n{}", "-".repeat(60));
    println!("ENFOQUE A: segment-level (speaker por max overlap)");
    println!("{}", "-".repeat(60));
    let old_segments = match transcribe_whisper(&audio, model_path, true, prompt) {
        Ok(s) => s,
        Err(e) => { eprintln!("  ERROR: {}", e); return; }
    };
    for (i, (s, e, t)) in old_segments.iter().enumerate() {
        let sp = find_best_speaker(*s, *e, &turns);
        println!("  [{:2}] {:6.2}s-{:6.2}s {:15} {}", i, s, e, format!("{:?}", sp), t);
    }

    // New approach (token-level splitting)
    println!("\n{}", "-".repeat(60));
    println!("ENFOQUE B: token-level splitting (cambio de hablante = break)");
    println!("{}", "-".repeat(60));
    let captions = split_tokens_by_speaker(&tokens, &turns);
    for (i, (s, e, text, sp)) in captions.iter().enumerate() {
        println!("  [{:2}] {:6.2}s-{:6.2}s {:15} {}", i, s, e, format!("{:?}", sp), text);
    }

    // Summary
    println!("\n{}", "=".repeat(60));
    println!("RESUMEN");
    println!("{}", "=".repeat(60));
    println!("  Enfoque A (segment-level): {} captions", old_segments.len());
    println!("  Enfoque B (token-level):   {} captions", captions.len());

    // Group by speaker for logical analysis
    let mut by_speaker: std::collections::BTreeMap<String, Vec<String>> = std::collections::BTreeMap::new();
    for (_, _, text, sp) in &captions {
        let key = sp.clone().unwrap_or_else(|| "None".to_string());
        by_speaker.entry(key).or_default().push(text.clone());
    }
    println!("\nDiálogo por speaker:");
    for (sp, lines) in &by_speaker {
        println!("\n  --- {} ({} lines) ---", sp, lines.len());
        for line in lines {
            println!("    {}", line);
        }
    }
}

fn calc_overlap(a_start: f64, a_end: f64, b_start: f64, b_end: f64) -> f64 {
    (a_end.min(b_end) - a_start.max(b_start)).max(0.0)
}

fn build_speaker_mapping(
    captions: &[(f64, f64, String, Option<String>)],
    ground_truth: &[GroundTruthSegment],
) -> std::collections::HashMap<String, String> {
    use std::collections::HashMap;
    let mut votes: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for (start, end, _, speaker) in captions {
        let sp = match speaker { Some(s) => s, None => continue };
        let mut best_overlap = 0.0f64;
        let mut best_gt = String::new();
        for gt in ground_truth {
            let overlap = calc_overlap(*start, *end, gt.start, gt.end);
            if overlap > best_overlap {
                best_overlap = overlap;
                best_gt = gt.speaker.clone();
            }
        }
        if best_overlap > 0.0 {
            votes.entry(sp.clone()).or_default().entry(best_gt).and_modify(|c| *c += 1).or_insert(1);
        }
    }
    votes.into_iter().map(|(k, v)| {
        let best = v.into_iter().max_by_key(|(_, c)| *c).map(|(s, _)| s).unwrap_or_default();
        (k, best)
    }).collect()
}

fn evaluate_caption_quality(
    captions: &[(f64, f64, String, Option<String>)],
    ground_truth: &[GroundTruthSegment],
    label: &str,
) {
    if captions.is_empty() {
        println!("  {}: 0 captions — saltando evaluación", label);
        return;
    }

    // Build speaker mapping: polyvoice SpeakerId -> SRT speaker name
    let mapping = build_speaker_mapping(captions, ground_truth);
    if !mapping.is_empty() {
        println!("  Mapeo de speakers:");
        for (k, v) in &mapping {
            println!("    {} -> {}", k, v);
        }
    }

    let mut correct_speaker = 0usize;
    let mut total_speaker = 0usize;
    let mut total_cer = 0.0;
    let mut cer_count = 0usize;
    let mut unmatched_gt = 0usize;

    for gt in ground_truth {
        let mut best_overlap = 0.0f64;
        let mut best_speaker: Option<&str> = None;
        let mut best_text: Option<&str> = None;

        for (start, end, text, speaker) in captions {
            let overlap = calc_overlap(*start, *end, gt.start, gt.end);
            if overlap > best_overlap {
                best_overlap = overlap;
                best_speaker = speaker.as_deref();
                best_text = Some(text.as_str());
            }
        }

        if best_overlap > 0.0 {
            if let Some(sp) = best_speaker {
                total_speaker += 1;
                // Map polyvoice SpeakerId to SRT speaker name
                let mapped = mapping.get(sp).map(|s| s.as_str());
                if mapped == Some(gt.speaker.as_str()) {
                    correct_speaker += 1;
                }
            }
            if let Some(text) = best_text {
                let cer = compute_cer(&gt.text, text);
                total_cer += cer;
                cer_count += 1;
            }
        } else {
            unmatched_gt += 1;
        }
    }

    let speaker_acc = if total_speaker > 0 { correct_speaker as f64 / total_speaker as f64 } else { 0.0 };
    let avg_cer = if cer_count > 0 { total_cer / cer_count as f64 } else { 1.0 };

    println!("  {}: {} captions, speaker_acc={:.1}%, avg_CER={:.4}, unmatched_GT={}",
        label, captions.len(), speaker_acc * 100.0, avg_cer, unmatched_gt);
}
