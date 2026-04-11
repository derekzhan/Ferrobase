# Ferrobase 快速开始指南

## 第一次运行

打开终端，进入项目目录：

```bash
cd ~/Documents/work/code/tools/Ferrobase
```

### 方式一：一键构建（推荐）

```bash
./build.sh
```

构建完成后，`.dmg` 文件在 `src-tauri/target/release/bundle/dmg/` 目录。

### 方式二：开发模式

```bash
# 先确保已安装 Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"

# 安装依赖（已完成）
# npm install  ← 已经运行过了，node_modules 已存在

# 开发模式启动（热更新）
npm run tauri dev
```

第一次编译 Rust 需要 **5-10 分钟**（下载并编译所有依赖），之后再次构建只需 **< 1 分钟**。

### 方式三：仅构建生产包

```bash
npm run tauri build
```

## 前置需求

| 工具 | 版本 | 安装方法 |
|------|------|---------|
| Rust | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) 或 `brew install node` |
| Xcode CLT | latest | `xcode-select --install` |

> ⚠️ **macOS 注意**：需要 macOS 12 Monterey 或更高版本

## npm 依赖

`node_modules` 已经在 Ferrobase 文件夹中生成好了，无需再次 `npm install`。

## 功能一览

- ✅ MySQL / PostgreSQL / SQLite 连接管理
- ✅ MongoDB / Redis 支持
- ✅ Monaco Editor（VS Code 同款编辑器）
- ✅ 深色/浅色主题
- ✅ 多 Tab 查询编辑器
- ✅ 虚拟化结果集（百万行不卡顿）
- ✅ 数据库资源树（库 → 表 → 字段）
- ✅ 查询历史（最近 500 条）
- ✅ 数据导出（CSV / JSON / SQL INSERT）
- ✅ 密码安全存储（macOS Keychain）
- ✅ 表结构查看（字段/索引/DDL/数据预览）
