// EasyWork - 音频设备枚举
// 通过系统音频 API 列出所有音频输出设备（扬声器、虚拟声卡等）。
// 前端调用 list_devices 命令即可获取设备列表。
// Windows: WASAPI / macOS: CoreAudio

use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
use std::collections::HashSet;

/// An audio output device available for system audio capture.
#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

/// List all available audio devices for capture.
/// Windows: output devices (WASAPI loopback). macOS: input devices (CoreAudio 不支持回环).
/// Devices are deduplicated by name and sorted (default first).
pub fn list_output_devices() -> Result<Vec<AudioDevice>, String> {
    let host = cpal::default_host();

    // macOS 捕获麦克风输入；Windows 捕获输出设备（回环）
    #[cfg(target_os = "macos")]
    let default_name = host
        .default_input_device()
        .map(|d| d.name().unwrap_or_default())
        .unwrap_or_default();
    #[cfg(not(target_os = "macos"))]
    let default_name = host
        .default_output_device()
        .map(|d| d.name().unwrap_or_default())
        .unwrap_or_default();

    let mut seen = HashSet::new();
    #[cfg(target_os = "macos")]
    let device_iter = host
        .input_devices()
        .map_err(|e| format!("无法枚举音频输入设备: {}", e))?;
    #[cfg(not(target_os = "macos"))]
    let device_iter = host
        .output_devices()
        .map_err(|e| format!("无法枚举音频输出设备: {}", e))?;

    let mut devices: Vec<AudioDevice> = device_iter
        .filter_map(|d| {
            let name = d.name().ok()?;
            if !seen.insert(name.clone()) {
                return None; // 跳过重复设备
            }
            Some(AudioDevice {
                is_default: name == default_name,
                id: name.clone(),
                name,
            })
        })
        .collect();

    // Sort: default device first, then alphabetical
    devices.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(devices)
}
