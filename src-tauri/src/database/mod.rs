// EasyWork - 数据库模块入口
// 声明 models（数据结构）和 repo（增删查改）两个子模块。

pub mod models;
pub mod repo;

use anyhow::{Context, Result};
use sqlx::sqlite::SqlitePool;
use std::path::Path;

/// 初始化数据库：创建目录、连接池、建表。
pub async fn init(app_dir: &Path) -> Result<SqlitePool> {
    std::fs::create_dir_all(app_dir)
        .context("创建应用数据目录失败")?;

    let db_path = app_dir.join("easywork.db");
    log::info!("Database path: {}", db_path.display());

    if !db_path.exists() {
        std::fs::File::create(&db_path)
            .context("创建数据库文件失败")?;
    }

    let conn_str = format!("sqlite:{}", db_path.to_string_lossy());
    log::info!("Connecting to: {}", conn_str);

    let pool = SqlitePool::connect(&conn_str)
        .await
        .context("连接数据库失败")?;

    repo::init_db(&pool)
        .await
        .context("初始化数据库表结构失败")?;

    Ok(pool)
}
