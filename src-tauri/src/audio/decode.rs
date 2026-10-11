// EasyWork - 音频读写与通用解码
// 存储统一为 WAV：新录音与导入副本为 16-bit 整数（浏览器可直接播放，
// 无需 _playback 副本），存量录音为 float32。WAV 读取走 read_wav_f32_hound
// 按真实采样格式解码；hound 打不开或读不出（float64 等）的 WAV、以及
// mp3/m4a/aac/flac/ogg 等导入格式，由 symphonia 解码为交织 f32 样本。

use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{Decoder, DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::{FormatOptions, FormatReader};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// 按扩展名判断是否走 hound 的原生 WAV 路径
pub fn is_wav_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("wav"))
        .unwrap_or(false)
}

/// 用 hound 读取 WAV 为交织 f32 样本，返回 (样本, 声道数, 采样率)。
/// hound 3.5 的 samples::<S>() 要求 S 与文件原生类型一致，否则逐样本报错
/// （用 f32 读整数 WAV 会得到空样本），所以按格式分派：
/// Float → f32 直读；Int → i32 容器读取后按位深归一化到 [-1, 1]。
pub fn read_wav_f32_hound(path: &str) -> Result<(Vec<f32>, u16, u32), String> {
    let mut reader =
        hound::WavReader::open(path).map_err(|e| format!("无法打开 WAV 文件: {}", e))?;
    let spec = reader.spec();
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .filter_map(|s| s.ok())
            .collect(),
        hound::SampleFormat::Int => {
            let scale = (1i64 << (spec.bits_per_sample.clamp(1, 32) - 1)) as f32;
            reader
                .samples::<i32>()
                .filter_map(|s| s.ok())
                .map(|v| v as f32 / scale)
                .collect()
        }
    };
    if samples.is_empty() {
        return Err("没有有效的音频采样".into());
    }
    Ok((samples, spec.channels, spec.sample_rate))
}

/// 把音频文件解码为交织 f32 样本。返回 (样本, 声道数, 采样率)。
pub fn decode_audio_file(path: &str) -> Result<(Vec<f32>, u16, u32), String> {
    let src = std::fs::File::open(path).map_err(|e| format!("无法打开文件: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(src), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let mut fmt_opts = FormatOptions::default();
    fmt_opts.enable_gapless = true;
    let meta_opts = MetadataOptions::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &fmt_opts, &meta_opts)
        .map_err(|e| format!("无法识别的音频格式（{}）", e))?;
    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "文件中没有可解码的音轨".to_string())?;
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("不支持的音频编码（{}）", e))?;

    let mut samples: Vec<f32> = Vec::new();
    let mut channels: u16 = 0;
    let mut sample_rate: u32 = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            // 文件读完：next_packet 以 UnexpectedEof 的 IO 错误表示结束
            Err(Error::IoError(ref e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(Error::ResetRequired) => break,
            Err(e) => return Err(format!("读取音频失败（{}）", e)),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let spec = *decoded.spec();
                channels = spec.channels.count() as u16;
                sample_rate = spec.rate;
                let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, spec);
                buf.copy_interleaved_ref(decoded);
                samples.extend_from_slice(buf.samples());
            }
            // 单个坏包跳过，继续解码（部分 mp3/m4a 流常见）
            Err(Error::DecodeError(_)) | Err(Error::IoError(_)) => continue,
            Err(e) => return Err(format!("解码音频失败（{}）", e)),
        }
    }

    if samples.is_empty() || channels == 0 || sample_rate == 0 {
        return Err("音频文件没有有效的采样数据".into());
    }
    Ok((samples, channels, sample_rate))
}

/// 把 16k 单声道 f32 样本写成 16-bit PCM WAV，存进录音目录。
/// 16-bit 整数是浏览器的原生可播格式（播放时无需再生成 _playback 副本），
/// 读取侧由 read_wav_f32_hound 按位深归一化解码。文件名带时间戳，冲突时追加序号。
pub fn write_wav_16k_mono(dir: &Path, samples: &[f32]) -> Result<String, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("无法创建音频目录: {}", e))?;
    let stem = chrono::Local::now()
        .format("imported_%Y-%m-%d_%H-%M-%S")
        .to_string();
    let mut path = dir.join(format!("{}.wav", stem));
    let mut n = 1;
    while path.exists() {
        path = dir.join(format!("{}-{}.wav", stem, n));
        n += 1;
    }

    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: 16000,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(&path, spec)
        .map_err(|e| format!("无法创建转存音频文件: {}", e))?;
    for &s in samples {
        let v = (s.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        writer
            .write_sample(v)
            .map_err(|e| format!("写入转存音频失败: {}", e))?;
    }
    writer
        .finalize()
        .map_err(|e| format!("保存转存音频失败: {}", e))?;
    Ok(path.to_string_lossy().to_string())
}
