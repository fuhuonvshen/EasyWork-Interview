// EasyWork - 实时降噪
// 当前实现：RNNoise 纯 Rust 移植 (nnnoiseless)，48kHz 单声道、480 采样(10ms)一帧。
// 设计为可替换 trait：后续想换 DeepFilterNet 时实现同一个 Denoiser 即可。

/// 降噪器要求的输入采样率（RNNoise 固定 48kHz）。
pub const DENOISE_RATE: u32 = 48_000;

const FRAME: usize = 480; // nnnoiseless::DenoiseState::FRAME_SIZE，48kHz 下 10ms

/// 降噪器接口。输入输出均为 48kHz 单声道 f32，归一化幅度 [-1.0, 1.0]。
pub trait Denoiser: Send {
    /// 就地处理一段音频；长度任意，不足一帧(10ms)的尾部数据缓存在内部，
    /// 下次调用时继续处理。
    fn process(&mut self, samples: &mut [f32]);
}

/// RNNoise (nnnoiseless) 实现。
pub struct RnnoiseDenoiser {
    state: Box<nnnoiseless::DenoiseState<'static>>,
    out: [f32; FRAME],
    pending: Vec<f32>,
    denoised: Vec<f32>,
}

impl RnnoiseDenoiser {
    pub fn new() -> Self {
        Self {
            state: nnnoiseless::DenoiseState::new(),
            out: [0.0; FRAME],
            pending: Vec::with_capacity(FRAME * 4),
            denoised: Vec::with_capacity(FRAME * 4),
        }
    }
}

impl Denoiser for RnnoiseDenoiser {
    fn process(&mut self, samples: &mut [f32]) {
        self.pending.extend_from_slice(samples);
        let mut input = [0.0f32; FRAME];
        while self.pending.len() >= FRAME {
            // nnnoiseless 的输入输出是 i16 满量程 [-32768, 32767]，不是 [-1, 1]
            for i in 0..FRAME {
                input[i] = self.pending[i].clamp(-1.0, 1.0) * 32767.0;
            }
            self.state.process_frame(&mut self.out, &input);
            self.denoised.extend(self.out.iter().map(|s| s * (1.0 / 32767.0)));
            self.pending.drain(..FRAME);
        }

        // pending 里的上一轮尾巴会让本轮降噪帧数超过 samples 长度
        // （7 声道设备实测 1680 样本会在第二轮写出 1920 个）。先缓存，
        // 只回写当前缓冲区放得下的部分，剩余留到下次。
        let n = samples.len().min(self.denoised.len());
        samples[..n].copy_from_slice(&self.denoised[..n]);
        self.denoised.drain(..n);
    }
}

/// 线性插值重采样（与 whisper/engine.rs 中同款算法）。
pub fn linear_resample(samples: &[f32], src_rate: u32, dst_rate: u32) -> Vec<f32> {
    if src_rate == dst_rate {
        return samples.to_vec();
    }
    let ratio = src_rate as f64 / dst_rate as f64;
    let out_len = (samples.len() as f64 / ratio).ceil() as usize;
    let mut out = Vec::with_capacity(out_len);
    for i in 0..out_len {
        let src_idx = (i as f64 * ratio) as usize;
        let frac = (i as f64 * ratio) - src_idx as f64;
        let a = samples.get(src_idx).copied().unwrap_or(0.0);
        let b = samples.get(src_idx + 1).copied().unwrap_or(a);
        out.push(a + (b - a) * frac as f32);
    }
    out
}

/// 多声道 → 单声道（取平均）。
pub fn downmix(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    samples
        .chunks(channels as usize)
        .map(|f| f.iter().sum::<f32>() / channels as f32)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_downmix_stereo() {
        let input = vec![1.0f32, 0.0, 1.0, 0.0];
        assert_eq!(downmix(&input, 2), vec![0.5, 0.5]);
    }

    #[test]
    fn test_linear_resample_passthrough() {
        let input = vec![0.1f32; 480];
        assert_eq!(linear_resample(&input, 48000, 48000), input);
    }

    #[test]
    fn test_linear_resample_48k_to_16k() {
        let input = vec![0.0f32; 48000];
        let out = linear_resample(&input, 48000, 16000);
        assert_eq!(out.len(), 16000);
    }

    #[test]
    fn test_rnnoise_process_preserves_length() {
        let mut d = RnnoiseDenoiser::new();
        // 恰好 3 帧
        let mut chunk = vec![0.1f32; FRAME * 3];
        d.process(&mut chunk);
        assert_eq!(chunk.len(), FRAME * 3);
        // 任意长度（跨帧边界）
        let mut chunk2 = vec![0.1f32; FRAME * 2 + 100];
        d.process(&mut chunk2);
        assert_eq!(chunk2.len(), FRAME * 2 + 100);
        // 尾部缓冲在下次调用继续处理
        let mut chunk3 = vec![0.1f32; 500];
        d.process(&mut chunk3);
        assert_eq!(chunk3.len(), 500);
    }

    #[test]
    fn test_rnnoise_non_frame_aligned_buffers_do_not_overflow() {
        // 7 声道回环/麦克风下混后每块 1680 样本（3.5 帧）。
        // 第二轮 pending 累积到 4 帧，旧实现会把 1920 个采样写进
        // 长度 1680 的缓冲区，越界 panic。
        let mut d = RnnoiseDenoiser::new();
        for _ in 0..10 {
            let mut chunk = vec![0.1f32; 1680];
            d.process(&mut chunk);
            assert_eq!(chunk.len(), 1680);
        }

        // 多种非帧对齐长度交替
        let mut d = RnnoiseDenoiser::new();
        for len in [240usize, 1680, 1000, 479, 481, 7, 11760] {
            let mut chunk = vec![0.1f32; len];
            d.process(&mut chunk);
            assert_eq!(chunk.len(), len);
        }
    }
}
