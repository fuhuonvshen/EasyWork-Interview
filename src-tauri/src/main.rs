// EasyWork - Rust 程序入口
// Windows 桌面应用的 main() 函数。
// 负责：禁止 release 模式下的控制台窗口弹出，然后启动 Tauri 应用。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    easywork::run();
}
