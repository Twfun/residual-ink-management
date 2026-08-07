import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_REMEMBERED_USERS,
  REMEMBERED_USERS_KEY,
  clearRememberedUsernames,
  loadRememberedUsernames,
  saveRememberedUsername,
} from './session';

// 内存版 localStorage，模拟浏览器/Tauri WebView 的持久化行为。
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
  } as Storage;
}

describe('记住账号（不记住密码）', () => {
  let storage: Storage;

  beforeEach(() => {
    storage = createMemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('空存储返回空列表', () => {
    expect(loadRememberedUsernames()).toEqual([]);
  });

  it('写入后最新账号在前，可读取', () => {
    saveRememberedUsername('admin');
    saveRememberedUsername('chemist');
    expect(loadRememberedUsernames()).toEqual(['chemist', 'admin']);
  });

  it('重复账号去重且提升到表头', () => {
    saveRememberedUsername('admin');
    saveRememberedUsername('chemist');
    saveRememberedUsername('admin');
    expect(loadRememberedUsernames()).toEqual(['admin', 'chemist']);
  });

  it('超过上限时截断（保留最新）', () => {
    for (let i = 1; i <= MAX_REMEMBERED_USERS + 3; i += 1) saveRememberedUsername(`user${i}`);
    const list = loadRememberedUsernames();
    expect(list).toHaveLength(MAX_REMEMBERED_USERS);
    expect(list[0]).toBe(`user${MAX_REMEMBERED_USERS + 3}`);
  });

  it('非法 JSON 容错返回空列表', () => {
    storage.setItem(REMEMBERED_USERS_KEY, '{not-valid-json');
    expect(loadRememberedUsernames()).toEqual([]);
  });

  it('非数组存储返回空列表', () => {
    storage.setItem(REMEMBERED_USERS_KEY, JSON.stringify({ a: 1 }));
    expect(loadRememberedUsernames()).toEqual([]);
  });

  it('清除后归零', () => {
    saveRememberedUsername('admin');
    clearRememberedUsernames();
    expect(loadRememberedUsernames()).toEqual([]);
    expect(storage.getItem(REMEMBERED_USERS_KEY)).toBeNull();
  });

  it('仅存账号，绝不写入密码', () => {
    saveRememberedUsername('admin');
    const raw = storage.getItem(REMEMBERED_USERS_KEY)!;
    expect(raw).not.toMatch(/password|pwd|secret/i);
    expect(JSON.parse(raw)).toEqual(['admin']);
  });
});