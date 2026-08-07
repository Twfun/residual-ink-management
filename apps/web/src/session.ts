// 记住登录账号（不记住密码）的本地工具。
// 仅持久化账号字符串，绝不写入密码。存储载体为 window.localStorage（Tauri WebView2 中持久化到应用数据目录，可跨软件重启保留）。

export const REMEMBERED_USERS_KEY = 'rim-remembered-usernames';
export const MAX_REMEMBERED_USERS = 10;

function rawUsernames(): string[] {
  try {
    const raw = localStorage.getItem(REMEMBERED_USERS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function write(list: string[]): void {
  try {
    localStorage.setItem(REMEMBERED_USERS_KEY, JSON.stringify(list));
  } catch {
    // 存储不可用时静默忽略，不影响登录。
  }
}

/** 读取已记住的账号（最新在前，去重保序）。 */
export function loadRememberedUsernames(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const name of rawUsernames()) {
    if (!seen.has(name)) {
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

/** 记录一次登录账号：去重并把最新账号放到表头，截断到上限。返回更新后的列表。 */
export function saveRememberedUsername(username: string): string[] {
  const name = username.trim();
  const next = [name, ...loadRememberedUsernames().filter((item) => item !== name)];
  write(next.slice(0, MAX_REMEMBERED_USERS));
  return next.slice(0, MAX_REMEMBERED_USERS);
}

/** 清空所有已记住的账号。 */
export function clearRememberedUsernames(): void {
  try {
    localStorage.removeItem(REMEMBERED_USERS_KEY);
  } catch {
    // 忽略。
  }
}