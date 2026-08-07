#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    fs::{self, File, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpStream},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const API_PORT: u16 = 39080;
const DATABASE_PORT: u16 = 39306;
const DATABASE_NAME: &str = "residual_ink_management";
const LOG_MAX_BYTES: u64 = 8 * 1024 * 1024;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct Bridge {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

struct RuntimeState {
    bridge: Mutex<Option<Bridge>>,
    api: Mutex<Option<Child>>,
    database: Mutex<Option<Child>>,
    startup_error: Mutex<Option<String>>,
    starting: Mutex<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BridgeStatus {
    bridge_path: String,
    dll_path: String,
    connected: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ServiceStatus {
    api_port: u16,
    database_port: u16,
    data_directory: String,
    backup_directory: String,
    log_directory: String,
    log_file: String,
    api_running: bool,
    database_running: bool,
    startup_error: Option<String>,
}

fn runtime_root() -> PathBuf {
    installation_dir().join("data")
}

/// 安装目录：即可执行文件所在目录。数据、日志、备份均保存在安装目录内，
/// 不再写入 C 盘用户目录（%LOCALAPPDATA%），便于随程序整体迁移。
fn installation_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|parent| parent.to_path_buf()))
        .unwrap_or_else(std::env::temp_dir)
}

fn log_directory() -> PathBuf {
    runtime_root().join("logs")
}

fn desktop_log_path() -> PathBuf {
    log_directory().join("desktop.log")
}

fn utc_timestamp() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();
    let days = (seconds / 86_400) as i64;
    let day_seconds = seconds % 86_400;
    // Civil date from day count (Howard Hinnant's algorithm), std-only.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = (z - era * 146_097) as u64;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era as i64 + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    };
    if month <= 2 {
        year += 1;
    }
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        day_seconds / 3600,
        (day_seconds % 3600) / 60,
        day_seconds % 60
    )
}

/// Append one line to the desktop launcher log. Never panics: logging must
/// stay available on every failure path, including from the panic hook.
fn log_event(level: &str, message: &str) {
    let path = desktop_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(metadata) = fs::metadata(&path) {
        if metadata.len() > LOG_MAX_BYTES {
            let _ = fs::rename(&path, path.with_file_name("desktop.old.log"));
        }
    }
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let flattened = message.replace(['\r', '\n'], " | ");
        let _ = writeln!(file, "{} [{level}] {flattened}", utc_timestamp());
    }
}

fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log_event("PANIC", &format!("{info}"));
        default_hook(info);
    }));
}

fn tail_text(path: &Path, bytes: usize) -> Option<String> {
    let content = fs::read(path).ok()?;
    let start = content.len().saturating_sub(bytes);
    let text = String::from_utf8_lossy(&content[start..]).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(text)
    }
}

fn resource_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().resource_dir().map_err(|error| error.to_string())
}

fn xrite_resources(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let root = resource_root(app)?.join("resources").join("xrite");
    let bridge = root.join("exact-bridge.exe");
    let dll = root.join("eXact.dll");
    if !bridge.is_file() || !dll.is_file() {
        return Err("X-Rite 安装资源不完整。".to_string());
    }
    Ok((bridge, dll))
}

fn xrite_request(
    app: &AppHandle,
    state: &RuntimeState,
    line: &str,
) -> Result<serde_json::Value, String> {
    let mut state = state
        .bridge
        .lock()
        .map_err(|_| "桥接进程状态锁定失败。".to_string())?;
    if state.is_none() {
        let (bridge, dll) = xrite_resources(app)?;
        log_event("INFO", &format!("starting X-Rite bridge: {}", bridge.display()));
        let mut command = Command::new(bridge);
        command
            .arg("--dll")
            .arg(&dll)
            .arg("serve")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        hide_window(&mut command);
        let mut child = command.spawn().map_err(|error| {
            log_event("ERROR", &format!("X-Rite bridge spawn failed: {error}"));
            error.to_string()
        })?;
        let stdin = child.stdin.take().ok_or("无法打开桥接输入。")?;
        let stdout = BufReader::new(child.stdout.take().ok_or("无法打开桥接输出。")?);
        let mut bridge = Bridge {
            child,
            stdin,
            stdout,
        };
        let mut ready = String::new();
        bridge
            .stdout
            .read_line(&mut ready)
            .map_err(|error| error.to_string())?;
        let status: serde_json::Value =
            serde_json::from_str(&ready).map_err(|error| error.to_string())?;
        if status.get("ok") != Some(&serde_json::Value::Bool(true)) {
            log_event("WARN", &format!("X-Rite bridge reported failure: {status}"));
            return Err(format!("桥接启动失败：{status}"));
        }
        log_event("INFO", "X-Rite bridge is ready");
        *state = Some(bridge);
    }
    let bridge = state.as_mut().ok_or("桥接进程不可用。")?;
    bridge
        .stdin
        .write_all(format!("{line}\n").as_bytes())
        .and_then(|_| bridge.stdin.flush())
        .map_err(|error| error.to_string())?;
    let mut response = String::new();
    bridge
        .stdout
        .read_line(&mut response)
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&response).map_err(|error| error.to_string())
}

fn start_xrite_connection(app: &AppHandle, state: &RuntimeState) {
    // Keep the bundled 32-bit bridge alive for the entire desktop session. A
    // missing instrument is an expected state and must not block application startup.
    match xrite_request(app, state, "connect") {
        Ok(_) => log_event("INFO", "X-Rite instrument connect request finished"),
        Err(error) => log_event("WARN", &format!("X-Rite connect skipped: {error}")),
    }
}

#[tauri::command]
fn xrite_status(app: AppHandle, state: tauri::State<RuntimeState>) -> Result<BridgeStatus, String> {
    let (bridge, dll) = xrite_resources(&app)?;
    Ok(BridgeStatus {
        bridge_path: bridge.display().to_string(),
        dll_path: dll.display().to_string(),
        connected: state
            .bridge
            .lock()
            .map_err(|_| "桥接状态锁定失败。")?
            .is_some(),
    })
}

#[tauri::command]
fn xrite_command(
    app: AppHandle,
    state: tauri::State<RuntimeState>,
    command: String,
) -> Result<serde_json::Value, String> {
    xrite_request(&app, &state, &command)
}

#[tauri::command]
fn service_status(state: tauri::State<RuntimeState>) -> Result<ServiceStatus, String> {
    let root = runtime_root();
    let startup_error = state
        .startup_error
        .lock()
        .map_err(|_| "启动状态锁定失败。")?
        .clone();
    Ok(ServiceStatus {
        api_port: API_PORT,
        database_port: DATABASE_PORT,
        data_directory: root.display().to_string(),
        backup_directory: root.join("backups").display().to_string(),
        log_directory: log_directory().display().to_string(),
        log_file: desktop_log_path().display().to_string(),
        api_running: child_running(&state.api)?,
        database_running: child_running(&state.database)?,
        startup_error,
    })
}

#[tauri::command]
fn recent_log_events(tail: Option<usize>) -> Result<Vec<String>, String> {
    let text = fs::read_to_string(desktop_log_path()).unwrap_or_default();
    let count = tail.unwrap_or(60).min(400);
    let lines: Vec<String> = text.lines().map(|line| line.to_string()).collect();
    let start = lines.len().saturating_sub(count);
    Ok(lines[start..].to_vec())
}

#[tauri::command]
fn open_log_directory() -> Result<String, String> {
    let directory = log_directory();
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    log_event("INFO", "user opened the log directory");
    let mut command = Command::new("explorer.exe");
    command.arg(&directory);
    hide_window(&mut command);
    command.spawn().map_err(|error| error.to_string())?;
    Ok(directory.display().to_string())
}

#[tauri::command]
fn retry_services(app: AppHandle, state: tauri::State<RuntimeState>) -> Result<(), String> {
    if child_running(&state.api)? && child_running(&state.database)? {
        return Ok(());
    }
    log_event("INFO", "service startup retry requested from the UI");
    spawn_service_startup(app);
    Ok(())
}

fn child_running(child: &Mutex<Option<Child>>) -> Result<bool, String> {
    let mut guard = child
        .lock()
        .map_err(|_| "服务进程状态锁定失败。".to_string())?;
    match guard.as_mut() {
        Some(process) => Ok(process
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_none()),
        None => Ok(false),
    }
}

fn port_in_use(port: u16) -> bool {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    TcpStream::connect_timeout(&address.into(), Duration::from_millis(300)).is_ok()
}

/// Runs service startup on a background thread so the window always opens,
/// even when MariaDB/API fail: the error is recorded in state and surfaced in
/// the UI instead of silently killing the app from `setup`.
fn spawn_service_startup(app: AppHandle) {
    {
        let state = app.state::<RuntimeState>();
        let mut starting = match state.starting.lock() {
            Ok(guard) => guard,
            Err(_) => return,
        };
        if *starting {
            return;
        }
        *starting = true;
    }
    thread::spawn(move || {
        let state = app.state::<RuntimeState>();
        if let Ok(mut slot) = state.startup_error.lock() {
            *slot = None;
        }
        log_event("INFO", "local service startup began");
        match start_local_services(&app, state.inner()) {
            Ok(()) => log_event("INFO", "local services are ready"),
            Err(error) => {
                log_event("ERROR", &format!("local service startup failed: {error}"));
                if let Ok(mut slot) = state.startup_error.lock() {
                    *slot = Some(error);
                }
            }
        }
        start_xrite_connection(&app, state.inner());
        if let Ok(mut starting) = state.starting.lock() {
            *starting = false;
        };
    });
}

fn start_local_services(app: &AppHandle, state: &RuntimeState) -> Result<(), String> {
    // A leftover API/database process would silently serve this window with an
    // outdated backend. Refuse to start instead of connecting to a stale service.
    if port_in_use(API_PORT) || port_in_use(DATABASE_PORT) {
        return Err(format!(
            "检测到残留的余墨管理服务进程（端口 {API_PORT} / {DATABASE_PORT} 已被占用），继续运行会连接到旧版本服务。请关闭所有余墨管理系统窗口，并在任务管理器中结束 residual-ink-api 与 mariadbd/mysqld 进程后重新打开。"
        ));
    }
    let runtime = runtime_root();
    let database_root = runtime.join("database").join("embedded-mariadb");
    let data_dir = database_root.join("data");
    let logs = runtime.join("logs");
    let backups = runtime.join("backups");
    fs::create_dir_all(&logs).map_err(|error| error.to_string())?;
    fs::create_dir_all(&backups).map_err(|error| error.to_string())?;
    log_event("INFO", &format!("runtime directory: {}", runtime.display()));

    let database_resources = resource_root(app)?.join("resources").join("database");
    let maria = database_resources.join("mariadb");
    let mysqld = maria.join("bin").join("mysqld.exe");
    if !mysqld.is_file() {
        return Err(format!("内置 MariaDB 不完整：{}", mysqld.display()));
    }
    if !data_dir.join("mysql").is_dir() {
        log_event("INFO", "initializing embedded MariaDB data directory");
        initialize_database(&maria, &data_dir)?;
        log_event("INFO", "MariaDB data directory initialized");
    }
    let ini = database_root.join("my.ini");
    let mariadb_log = database_root.join("mariadb.log");
    write_database_config(&ini, &maria, &data_dir, &mariadb_log)?;
    let mut database_command = Command::new(&mysqld);
    database_command
        .arg(format!("--defaults-file={}", ini.display()))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_window(&mut database_command);
    let database = database_command.spawn().map_err(|error| {
        log_event("ERROR", &format!("mysqld spawn failed: {error}"));
        format!("MariaDB 启动失败：{error}")
    })?;
    *state
        .database
        .lock()
        .map_err(|_| "数据库状态锁定失败。".to_string())? = Some(database);
    log_event("INFO", "mysqld spawned, waiting for its port");
    wait_for_child_port(
        DATABASE_PORT,
        Duration::from_secs(60),
        "MariaDB",
        &state.database,
        Some(&mariadb_log),
    )?;
    log_event("INFO", "MariaDB port is open");
    apply_schema(&maria, &database_resources.join("schema.sql"))?;
    log_event("INFO", "database schema applied");

    let api_path = resolve_api_sidecar(app)?;
    log_event("INFO", &format!("resolved API sidecar: {}", api_path.display()));
    let jwt_secret = load_or_create_secret(&runtime.join("jwt.secret"))?;
    let api_log_path = logs.join("residual-ink-api.log");
    let api_log = open_log(&api_log_path)?;
    let api_error_log = api_log.try_clone().map_err(|error| error.to_string())?;
    let mut api_command = Command::new(&api_path);
    api_command
        .env("RIM_API_PORT", API_PORT.to_string())
        .env("RIM_BACKUP_DIR", backups)
        .env("JWT_SECRET", jwt_secret)
        .env(
            "DATABASE_URL",
            format!("mysql://root@127.0.0.1:{DATABASE_PORT}/{DATABASE_NAME}?connection_limit=8"),
        )
        .current_dir(api_path.parent().unwrap_or_else(|| Path::new(".")))
        .stdout(Stdio::from(api_log))
        .stderr(Stdio::from(api_error_log));
    hide_window(&mut api_command);
    let api = api_command.spawn().map_err(|error| {
        log_event("ERROR", &format!("API spawn failed: {error}"));
        format!("API 启动失败：{error}")
    })?;
    *state
        .api
        .lock()
        .map_err(|_| "API 状态锁定失败。".to_string())? = Some(api);
    log_event("INFO", "API sidecar spawned, waiting for its port");
    wait_for_child_port(
        API_PORT,
        Duration::from_secs(90),
        "API",
        &state.api,
        Some(&api_log_path),
    )?;
    log_event("INFO", "API port is open");
    Ok(())
}

fn initialize_database(maria: &Path, data_dir: &Path) -> Result<(), String> {
    fs::create_dir_all(data_dir).map_err(|error| error.to_string())?;
    let initializer = maria.join("bin").join("mariadb-install-db.exe");
    let fallback = maria.join("bin").join("mysql_install_db.exe");
    let program = if initializer.is_file() {
        initializer
    } else {
        fallback
    };
    if !program.is_file() {
        return Err("内置 MariaDB 缺少初始化程序。".to_string());
    }
    let mut command = Command::new(&program);
    command
        .arg(format!("--datadir={}", data_dir.display()))
        .arg("--password=")
        .arg(format!("--port={DATABASE_PORT}"))
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_window(&mut command);
    let status = command.status().map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(format!("MariaDB 初始化失败，退出码：{status}"));
    }
    Ok(())
}

fn write_database_config(ini: &Path, maria: &Path, data: &Path, log: &Path) -> Result<(), String> {
    let text = format!(
        "[mysqld]\nbasedir={}\ndatadir={}\nport={DATABASE_PORT}\nbind-address=127.0.0.1\ncharacter-set-server=utf8mb4\ncollation-server=utf8mb4_unicode_ci\nmax_connections=64\ninnodb_buffer_pool_size=96M\nperformance_schema=OFF\nskip-name-resolve\nlog-error={}\n",
        ini_path(maria), ini_path(data), ini_path(log)
    );
    if let Some(parent) = ini.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(ini, text).map_err(|error| error.to_string())
}

fn apply_schema(maria: &Path, schema_path: &Path) -> Result<(), String> {
    let mut schema = String::new();
    File::open(schema_path)
        .and_then(|mut file| file.read_to_string(&mut schema))
        .map_err(|error| format!("读取数据库 schema 失败：{error}"))?;
    let client = ["mariadb.exe", "mysql.exe"]
        .into_iter()
        .map(|name| maria.join("bin").join(name))
        .find(|path| path.is_file())
        .ok_or("内置 MariaDB 缺少客户端。")?;
    let mut command = Command::new(client);
    command
        .arg("--protocol=tcp")
        .arg("--ssl=0")
        .arg("--host=127.0.0.1")
        .arg(format!("--port={DATABASE_PORT}"))
        .arg("--user=root")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    hide_window(&mut command);
    let mut process = command.spawn().map_err(|error| error.to_string())?;
    process
        .stdin
        .take()
        .ok_or("无法写入数据库 schema。")?
        .write_all(schema.as_bytes())
        .map_err(|error| error.to_string())?;
    let output = process
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "应用数据库 schema 失败：{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

fn resolve_api_sidecar(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(executable) = std::env::current_exe() {
        if let Some(directory) = executable.parent() {
            candidates.push(directory.join("residual-ink-api.exe"));
            candidates.push(
                directory
                    .join("binaries")
                    .join("residual-ink-api-x86_64-pc-windows-msvc.exe"),
            );
        }
    }
    let resources = resource_root(app)?;
    candidates.push(resources.join("residual-ink-api.exe"));
    candidates.push(
        resources
            .join("binaries")
            .join("residual-ink-api-x86_64-pc-windows-msvc.exe"),
    );
    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or("找不到内置 API 程序。".to_string())
}

/// Waits for a service port while watching the child process. If the child
/// exits early (missing VC++ runtime, bad config, ...), report immediately
/// with the tail of its own log instead of hanging until the timeout.
fn wait_for_child_port(
    port: u16,
    timeout: Duration,
    label: &str,
    child: &Mutex<Option<Child>>,
    log_hint: Option<&Path>,
) -> Result<(), String> {
    let started = Instant::now();
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, port);
    while started.elapsed() < timeout {
        if let Ok(mut guard) = child.lock() {
            if let Some(process) = guard.as_mut() {
                if let Ok(Some(status)) = process.try_wait() {
                    let mut error = format!("{label} 进程启动后提前退出（{status}）。");
                    if let Some(path) = log_hint {
                        if let Some(tail) = tail_text(path, 4000) {
                            log_event("ERROR", &format!("{label} log tail: {tail}"));
                            error.push_str(&format!(" 日志末尾：{tail}"));
                        }
                    }
                    return Err(error);
                }
            }
        }
        if TcpStream::connect_timeout(&address.into(), Duration::from_millis(500)).is_ok() {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(250));
    }
    let mut error = format!("{label} 未在规定时间内启动。");
    if let Some(path) = log_hint {
        if let Some(tail) = tail_text(path, 4000) {
            log_event("ERROR", &format!("{label} log tail after timeout: {tail}"));
            error.push_str(&format!(" 日志末尾：{tail}"));
        }
    }
    Err(error)
}

fn load_or_create_secret(path: &Path) -> Result<String, String> {
    if let Ok(value) = fs::read_to_string(path) {
        if value.trim().len() >= 32 {
            return Ok(value.trim().to_string());
        }
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let secret = format!("rim-{nanos:032x}-{:08x}", std::process::id());
    fs::write(path, &secret).map_err(|error| error.to_string())?;
    Ok(secret)
}

fn open_log(path: &Path) -> Result<File, String> {
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|error| error.to_string())
}

fn ini_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
}

fn shutdown(state: &RuntimeState, app: &AppHandle) {
    log_event("INFO", "shutdown requested, stopping local services");
    if let Ok(mut api) = state.api.lock() {
        if let Some(mut process) = api.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
    if let Ok(root) = resource_root(app) {
        let admin = root
            .join("resources")
            .join("database")
            .join("mariadb")
            .join("bin")
            .join("mariadb-admin.exe");
        if admin.is_file() {
            let mut command = Command::new(admin);
            command
                .arg("--protocol=tcp")
                .arg("--ssl=0")
                .arg("--host=127.0.0.1")
                .arg(format!("--port={DATABASE_PORT}"))
                .arg("--user=root")
                .arg("shutdown")
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            hide_window(&mut command);
            let _ = command.status();
        }
    }
    if let Ok(mut database) = state.database.lock() {
        if let Some(mut process) = database.take() {
            thread::sleep(Duration::from_millis(800));
            if process.try_wait().ok().flatten().is_none() {
                let _ = process.kill();
            }
            let _ = process.wait();
        }
    }
    if let Ok(mut bridge) = state.bridge.lock() {
        if let Some(mut process) = bridge.take() {
            let _ = process.stdin.write_all(b"quit\n");
            let _ = process.stdin.flush();
            let _ = process.child.wait();
        }
    }
    log_event("INFO", "shutdown finished");
}

fn main() {
    install_panic_hook();
    log_event("INFO", "desktop application starting");
    tauri::Builder::default()
        .manage(RuntimeState {
            bridge: Mutex::new(None),
            api: Mutex::new(None),
            database: Mutex::new(None),
            startup_error: Mutex::new(None),
            starting: Mutex::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            xrite_status,
            xrite_command,
            service_status,
            recent_log_events,
            open_log_directory,
            retry_services
        ])
        .setup(|app| {
            spawn_service_startup(app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start residual ink desktop app")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                shutdown(app.state::<RuntimeState>().inner(), app);
            }
        });
}