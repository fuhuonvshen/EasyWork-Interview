// EasyWork - 系统音频捕获
// 跨平台：Windows WASAPI 回环捕获 / macOS CoreAudio
// → ringbuf → WAV 文件 + mpsc 实时音频通道。
//
// 架构：
//   CPAL 音频回调(热路径) → ringbuf → 写文件线程 → WAV
//                        → mpsc   → 实时转写 worker

use anyhow::{Context, Result};

/// macOS 上请求麦克风权限（必须在主线程调用，结果通过 oneshot 异步返回）。
///
/// cpal (AVAudioEngine) 不会自动触发系统的麦克风权限弹窗，而未授权时
/// macOS 静默输出静音（不报错）。这里通过 AVAudioApplication (macOS 14+)
/// 显式触发 TCC 权限弹窗。**注意**：本函数只发起请求，不能同步阻塞等待
/// 回调——TCC 弹窗与回调需要主线程空闲，阻塞会死锁导致弹窗不出现。
/// 失败原因通过 Err 返回，前端错误提示直接展示，便于诊断。
#[cfg(target_os = "macos")]
pub fn request_mic_permission(tx: tokio::sync::oneshot::Sender<Result<bool, String>>) {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_avf_audio::{AVAudioApplication, AVAudioApplicationRecordPermission};
    use objc2_foundation::MainThreadMarker;

    let Some(_marker) = MainThreadMarker::new() else {
        let _ = tx.send(Err("权限请求必须在主线程调用".to_string()));
        return;
    };
    unsafe {
        let app = AVAudioApplication::sharedInstance();
        let current = app.recordPermission();
        if current == AVAudioApplicationRecordPermission::Granted {
            let _ = tx.send(Ok(true));
            return;
        }
        if current == AVAudioApplicationRecordPermission::Denied {
            // TCC 已有拒绝记录（可能来自旧签名版本），重置后才会重新弹窗
            let _ = tx.send(Err(
                "麦克风权限已被拒绝（状态 Denied）。请在终端执行 tccutil reset Microphone com.easywork 后重试".to_string(),
            ));
            return;
        }
        // Undetermined — 弹系统权限框，回调异步返回结果
        // oneshot::Sender::send 消费自身 → 闭包只能 FnOnce，而 block2 要求 Fn。
        // 用 Arc<Mutex<Option<..>>> 包装，闭包捕获 Arc（可重复调用），take 一次。
        let tx = std::sync::Arc::new(std::sync::Mutex::new(Some(tx)));
        let block = RcBlock::new(move |granted: Bool| {
            if let Some(t) = tx.lock().unwrap().take() {
                let _ = t.send(Ok(granted.as_bool()));
            }
        });
        AVAudioApplication::requestRecordPermissionWithCompletionHandler(&block);
    }
}
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ringbuf::traits::{Consumer, Producer, Split};
use ringbuf::HeapRb;
use std::fs;
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::mpsc;

/// State of an ongoing audio capture session.
pub struct AudioCapture {
    streams: Vec<cpal::Stream>,
    stop_flag: Arc<AtomicBool>,
    writer_handle: Option<std::thread::JoinHandle<()>>,
    output_path: PathBuf,
    callback_count: Arc<std::sync::atomic::AtomicU64>,

    /// The audio format used during this capture.
    pub sample_rate: u32,
    pub channels: u16,

    /// Real-time audio chunks for transcription.
    pub audio_rx: mpsc::UnboundedReceiver<Vec<f32>>,
    pub mic_audio_rx: mpsc::UnboundedReceiver<Vec<f32>>,
}

pub struct CaptureConfig {
    pub device_name: String,
    pub output_dir: PathBuf,
    pub label: String,
}

impl AudioCapture {
    pub fn start(config: CaptureConfig) -> Result<Self> {
        let host = cpal::default_host();

        // macOS: CoreAudio 不支持输出设备回环捕获，直接使用麦克风输入
        #[cfg(target_os = "macos")]
        let (device, supported_config) = {
            let dev = if let Some(d) = host
                .input_devices()
                .ok()
                .and_then(|mut ds| ds.find(|d| {
                    d.name().map(|n| n == config.device_name).unwrap_or(false)
                }))
            {
                log::info!("Found input device: {}", config.device_name);
                d
            } else {
                let d = host.default_input_device()
                    .context("未找到音频设备")?;
                log::info!("Using default input device (mic)");
                d
            };
            let cfg = dev.default_input_config()
                .context("无法获取输入配置")?;
            (dev, cfg)
        };

        // Windows: WASAPI 回环捕获输出设备
        #[cfg(not(target_os = "macos"))]
        let (device, supported_config) = if let Some(dev) = host
            .output_devices()
            .ok()
            .and_then(|mut devices| devices.find(|d| {
                d.name().map(|n| n == config.device_name).unwrap_or(false)
            }))
        {
            log::info!("Found output device: {}", config.device_name);
            // Use supported_input_configs on output device (loopback path)
            let cfg = dev.supported_input_configs()
                .ok()
                .and_then(|mut configs| {
                    configs.find(|c| c.sample_format() == cpal::SampleFormat::F32)
                })
                .map(|c| c.with_max_sample_rate());

            if let Some(cfg) = cfg {
                log::info!("Using loopback input config");
                (dev, cfg)
            } else {
                let cfg = dev.default_output_config()
                    .context("无法获取输出配置")?;
                log::info!("Using default output config for loopback");
                (dev, cfg)
            }
        } else {
            let dev = host.default_input_device()
                .context("未找到音频设备")?;
            let cfg = dev.default_input_config()
                .context("无法获取输入配置")?;
            log::info!("Using default input device (mic)");
            (dev, cfg)
        };

        let sample_format = supported_config.sample_format();
        let sample_rate = supported_config.sample_rate();
        let channels = supported_config.channels() as u16;

        // Separate mpsc channels for transcription (unchanged)
        let (audio_tx, audio_rx) = mpsc::unbounded_channel::<Vec<f32>>();
        let (mic_tx, mic_audio_rx) = mpsc::unbounded_channel::<Vec<f32>>();

        // Dual ring buffers for meetily-style mixer
        let ringbuf_capacity = (sample_rate as usize) * (channels as usize) * 2;
        let (mut sys_prod, mut sys_cons) = HeapRb::<f32>::new(ringbuf_capacity).split();
        let (mut mic_prod, mut mic_cons) = HeapRb::<f32>::new(ringbuf_capacity).split();

        let stop_flag = Arc::new(AtomicBool::new(false));
        let stop_flag_for_callback = stop_flag.clone();
        let stop_flag_for_writer = stop_flag.clone();
        let callback_count = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let callback_count_for_stop = callback_count.clone();

        // WAV output path (YYYY-MM-DD_HH-MM.wav — pure time-based to avoid
        // sanitized-Chinese underscores and to distinguish multiple meetings/day)
        fs::create_dir_all(&config.output_dir).context("无法创建输出目录")?;
        let datetime_str = chrono::Local::now().format("%Y-%m-%d_%H-%M").to_string();
        let filename = format!("{}.wav", datetime_str);
        let output_path = config.output_dir.join(&filename);
        let output_path_for_writer = output_path.clone();

        // ── Loopback stream (WAV + transcription) ────────
        let stream_config: cpal::StreamConfig = supported_config.into();
        let stop_lb = stop_flag_for_callback.clone();
        let cb_lb = callback_count.clone();

        let stream = device
            .build_input_stream(
                &stream_config,
                move |data: &[f32], _info| {
                    if stop_lb.load(Ordering::Relaxed) || data.is_empty() {
                        return;
                    }
                    cb_lb.fetch_add(1, Ordering::Relaxed);
                    let _ = sys_prod.push_slice(data);
                    let _ = audio_tx.send(data.to_vec());
                },
                move |err| {
                    log::error!("Loopback error: {}", err);
                },
                None,
            )
            .context("无法启动音频流")?;

        stream.play().context("无法开始音频捕获")?;
        let mut streams = vec![stream];

        // ── Mic stream ────────────────────────────────────
        // macOS 主设备已是麦克风，无需单独麦克风流
        #[cfg(not(target_os = "macos"))]
        if let Some(mic) = host.default_input_device() {
            if let Ok(mic_cfg) = mic.default_input_config() {
                let mic_name = mic.name().unwrap_or_default();
                let mic_rate = mic_cfg.sample_rate();
                let mic_ch = mic_cfg.channels();
                let mic_config: cpal::StreamConfig = mic_cfg.into();
                log::info!("Adding mic: {} ({}Hz, {}ch)", mic_name, mic_rate, mic_ch);

                let tx_mic = mic_tx.clone();
                let stop_mic = stop_flag_for_callback.clone();
                let cb_mic = callback_count.clone();

                match mic.build_input_stream(
                    &mic_config,
                    move |data: &[f32], _info| {
                        if stop_mic.load(Ordering::Relaxed) || data.is_empty() {
                            return;
                        }
                        cb_mic.fetch_add(1, Ordering::Relaxed);
                        let _ = mic_prod.push_slice(data);
                        let _ = tx_mic.send(data.to_vec());
                    },
                    move |err| {
                        log::error!("Mic error: {}", err);
                    },
                    None,
                ) {
                    Ok(mic_stream) => {
                        mic_stream.play().ok();
                        streams.push(mic_stream);
                    }
                    Err(e) => {
                        log::warn!("无法启动麦克风: {}", e);
                    }
                }
            }
        }

        // ── Mixer + Writer thread (meetily-style: dual buffer → aligned mix) ──
        let writer_handle = std::thread::spawn(move || {
            let spec = hound::WavSpec {
                channels,
                sample_rate,
                bits_per_sample: 32,
                sample_format: hound::SampleFormat::Float,
            };
            let mut writer = match hound::WavWriter::create(&output_path_for_writer, spec) {
                Ok(w) => w,
                Err(e) => {
                    log::error!("无法创建 WAV 文件: {}", e);
                    return;
                }
            };

            let mut sys_buf = vec![0.0f32; 1024];
            let mut mic_buf = vec![0.0f32; 1024];
            let mut sys_queue: Vec<f32> = Vec::new();
            let mut mic_queue: Vec<f32> = Vec::new();
            let window_size = (sample_rate as usize) * (channels as usize) / 10; // 100ms
            let mut total_written: u64 = 0;

            loop {
                // Drain ring buffers
                let sys_n = sys_cons.pop_slice(&mut sys_buf);
                if sys_n > 0 { sys_queue.extend_from_slice(&sys_buf[..sys_n]); }
                let mic_n = mic_cons.pop_slice(&mut mic_buf);
                if mic_n > 0 { mic_queue.extend_from_slice(&mic_buf[..mic_n]); }

                // Mix when both have enough data (meetily-style: align windows, sum, soft-clip)
                while sys_queue.len() >= window_size && mic_queue.len() >= window_size {
                    let sys_win: Vec<f32> = sys_queue.drain(..window_size).collect();
                    let mic_win: Vec<f32> = mic_queue.drain(..window_size).collect();

                    for i in 0..window_size {
                        let s = sys_win[i];
                        let m = mic_win[i];
                        let sum = s + m;
                        // Meetily-style soft clipping
                        let mixed = if sum > 1.0 { 1.0 + (sum - 1.0) * 0.1 }
                            else if sum < -1.0 { -1.0 + (sum + 1.0) * 0.1 }
                            else { sum };
                        let _ = writer.write_sample(mixed);
                        total_written += 1;
                    }
                }
                // macOS: 无麦克风流 → 只写主设备数据
                while sys_queue.len() >= window_size && mic_queue.is_empty() {
                    let win: Vec<f32> = sys_queue.drain(..window_size).collect();
                    for &s in &win {
                        let _ = writer.write_sample(s.clamp(-1.0, 1.0));
                        total_written += 1;
                    }
                }
                // 反向兜底：只有麦克风数据
                while mic_queue.len() >= window_size && sys_queue.is_empty() {
                    let win: Vec<f32> = mic_queue.drain(..window_size).collect();
                    for &m in &win {
                        let _ = writer.write_sample(m.clamp(-1.0, 1.0));
                        total_written += 1;
                    }
                }

                let stopped = stop_flag_for_writer.load(Ordering::Relaxed);
                if stopped {
                    // Drain remaining data
                    // Write remaining sys data directly (no mic to mix with)
                    if !sys_queue.is_empty() {
                        for &s in &sys_queue {
                            let _ = writer.write_sample(s.clamp(-1.0, 1.0));
                            total_written += 1;
                        }
                        sys_queue.clear();
                    }
                    // Write remaining mic data
                    if !mic_queue.is_empty() {
                        for &m in &mic_queue {
                            let _ = writer.write_sample(m.clamp(-1.0, 1.0));
                            total_written += 1;
                        }
                        mic_queue.clear();
                    }
                    // Final drain of ring buffers
                    loop {
                        let n = sys_cons.pop_slice(&mut sys_buf);
                        if n == 0 { break; }
                        for &s in &sys_buf[..n] {
                            let _ = writer.write_sample(s);
                            total_written += 1;
                        }
                    }
                    loop {
                        let n = mic_cons.pop_slice(&mut mic_buf);
                        if n == 0 { break; }
                        for &m in &mic_buf[..n] {
                            let _ = writer.write_sample(m);
                            total_written += 1;
                        }
                    }
                    break;
                }
                if sys_queue.is_empty() && mic_queue.is_empty() {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
            }

            log::info!("Mixer+WAV: {} total samples written", total_written);
            if let Err(e) = writer.finalize() {
                log::error!("WAV finalize 失败: {}", e);
            } else {
                log::info!("WAV 文件已保存: {:?}", output_path_for_writer);
            }
        });

        Ok(Self {
            streams,
            stop_flag,
            writer_handle: Some(writer_handle),
            output_path,
            callback_count: callback_count_for_stop,
            sample_rate,
            channels,
            audio_rx,
            mic_audio_rx,
        })
    }

    pub fn stop(mut self) -> Result<PathBuf> {
        self.stop_flag.store(true, Ordering::SeqCst);
        let cb_count = self.callback_count.load(Ordering::Relaxed);
        self.streams.clear(); // Drop all streams
        if let Some(handle) = self.writer_handle.take() {
            let _ = handle.join();
        }
        log::info!(
            "音频捕获已停止: CPAL回调 {} 次, 文件: {:?}",
            cb_count, self.output_path
        );
        Ok(self.output_path)
    }

    pub fn is_active(&self) -> bool {
        !self.stop_flag.load(Ordering::Relaxed)
    }
}
