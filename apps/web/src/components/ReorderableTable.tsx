import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Divider, Table } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import type { TableColumnType, TableProps } from 'antd';

/**
 * 支持表头拖拽换位 + 右键显示/隐藏列的表格封装。
 * 固定列（fixed）不参与拖拽，也不允许隐藏；其余列可拖拽调整顺序、右键勾选显隐。
 * 传入 storageKey 时，列顺序与列显隐都会持久化到 localStorage，下次登录自动恢复；
 * 未传 storageKey 时仅保存在内存中（页面会话内有效）。
 *
 * 拖拽实现说明：
 * 使用 Pointer 事件（pointerdown/pointermove/pointerup）+ document.elementFromPoint
 * 实现，不依赖浏览器原生 HTML5 drag-and-drop。
 * 原因是原生 DnD 在 WebView2/Edge、fixed 列双表格、横向滚动容器等叠加场景下
 * 拖拽手势常被吞掉而无法启动（表现为“拖不动”），Pointer 方案则完全可控。
 */
const STORAGE_PREFIX = 'rim-col-order:';
const HIDDEN_PREFIX = 'rim-col-hidden:';
const PAGE_SIZE_PREFIX = 'rim-page-size:';

function readStoredOrder(key: string | undefined, columns: readonly any[]): number[] | null {
  if (!key || columns.length === 0) return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== columns.length) return null;
    const seen = new Set<number>();
    for (const value of parsed) {
      if (!Number.isInteger(value) || value < 0 || value >= columns.length || seen.has(value)) return null;
      seen.add(value);
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredOrder(key: string | undefined, order: number[]) {
  if (!key) return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(order));
  } catch {
    // 忽略写入失败（如隐私模式禁用存储）
  }
}

function readStoredHidden(key: string | undefined, columns: readonly any[]): Set<number> {
  const empty = new Set<number>();
  if (!key || columns.length === 0) return empty;
  try {
    const raw = localStorage.getItem(HIDDEN_PREFIX + key);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return empty;
    const set = new Set<number>();
    for (const value of parsed) {
      if (Number.isInteger(value) && value >= 0 && value < columns.length) set.add(value);
    }
    return set;
  } catch {
    return empty;
  }
}

function writeStoredHidden(key: string | undefined, hidden: Set<number>) {
  if (!key) return;
  try {
    localStorage.setItem(HIDDEN_PREFIX + key, JSON.stringify([...hidden].sort((a, b) => a - b)));
  } catch {
    // 忽略写入失败
  }
}

function readStoredPageSize(key: string | undefined): number | undefined {
  if (!key) return undefined;
  try {
    const raw = localStorage.getItem(PAGE_SIZE_PREFIX + key);
    if (!raw) return undefined;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeStoredPageSize(key: string | undefined, size: number) {
  if (!key) return;
  try {
    localStorage.setItem(PAGE_SIZE_PREFIX + key, String(size));
  } catch {
    // 忽略写入失败
  }
}

/**
 * 将「可见列新顺序」合并回完整列顺序。
 * 隐藏列保持其在原完整顺序中的位置不变，仅重排可见列。
 */
function rebuildOrder(order: number[], hidden: Set<number>, newVisibleSeq: number[]): number[] {
  const hiddenSlots = new Map<number, number>(); // 隐藏列的原始完整位置
  order.forEach((value, position) => {
    if (hidden.has(value)) hiddenSlots.set(value, position);
  });
  const next = new Array(order.length);
  let visibleIndex = 0;
  for (let position = 0; position < order.length; position++) {
    const value = order[position];
    if (hidden.has(value)) {
      next[position] = value; // 隐藏列原地不动
    } else {
      next[position] = newVisibleSeq[visibleIndex++];
    }
  }
  return next;
}

function columnKey(col: TableColumnType<any>, index: number): React.Key {
  return col.key ?? (col.dataIndex as React.Key) ?? index;
}

function columnTitleText(col: TableColumnType<any>): React.ReactNode {
  const title = col.title;
  if (typeof title === 'string' || typeof title === 'number') return title;
  return (col.dataIndex as React.Key) ?? '';
}

/** 右键表头时弹出的「显示/隐藏列」菜单 */
function ColumnVisibilityMenu({
  x,
  y,
  columns,
  hidden,
  onToggle,
  onShowAll,
  onReset,
  onClose,
}: {
  x: number;
  y: number;
  columns: TableColumnType<any>[];
  hidden: Set<number>;
  onToggle: (index: number) => void;
  onShowAll: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onScroll = () => onClose();
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [onClose]);

  // 菜单尺寸（估算），避免超出视口
  const menuWidth = 240;
  const itemHeight = 30;
  const menuHeight = 46 + columns.length * itemHeight + 40;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, Math.max(8, window.innerHeight - menuHeight - 8));

  return (
    <div ref={ref} className="reorderable-col-menu" style={{ left, top }}>
      <div className="reorderable-col-menu-title">显示 / 隐藏列</div>
      <ul className="reorderable-col-menu-list">
        {columns.map((col, index) => (
          <li key={columnKey(col, index)}>
            <Checkbox checked={!hidden.has(index)} onChange={() => onToggle(index)}>
              <span className="reorderable-col-menu-label">{columnTitleText(col)}</span>
            </Checkbox>
          </li>
        ))}
      </ul>
      <Divider style={{ margin: '6px 0' }} />
      <div className="reorderable-col-menu-footer">
        <Button size="small" type="link" onClick={onShowAll}>
          全部显示
        </Button>
        <Button size="small" type="link" onClick={onReset} icon={<UndoOutlined />}>
          恢复默认
        </Button>
        <Button size="small" type="link" onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );
}

export function ReorderableTable<T extends object>({ columns = [], storageKey, title, pagination, className, ...rest }: TableProps<T> & { storageKey?: string }) {
  // 初始顺序：优先读取本地存储，否则用默认排列
  const [order, setOrder] = useState<number[]>(() => readStoredOrder(storageKey, columns) ?? columns.map((_, i) => i));
  // 隐藏列集合（存原始列下标）
  const [hidden, setHidden] = useState<Set<number>>(() => readStoredHidden(storageKey, columns));
  const storageKeyRef = useRef(storageKey);
  storageKeyRef.current = storageKey;
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  // 右键菜单位置
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  // 拖拽状态：from 为源列序，to 为当前悬停目标列序（可为 null）
  const [dragState, setDragState] = useState<{ from: number; to: number | null } | null>(null);
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
  const dragFromRef = useRef<number | null>(null);

  // 每页条数：优先读取本地存储，否则用分页默认值
  const hasPagination = pagination !== false;
  const basePageSize =
    typeof pagination === 'object' && pagination && typeof pagination.defaultPageSize === 'number'
      ? pagination.defaultPageSize
      : 10;
  const [pageSize, setPageSize] = useState<number | undefined>(() => {
    if (!storageKey || !hasPagination) return undefined;
    return readStoredPageSize(storageKey) ?? basePageSize;
  });
  const existingOnShowSizeChange =
    typeof pagination === 'object' && pagination && typeof pagination.onShowSizeChange === 'function'
      ? pagination.onShowSizeChange
      : undefined;

  const resolvedPagination = !hasPagination
    ? pagination
    : {
        ...(typeof pagination === 'object' && pagination ? pagination : {}),
        ...(storageKey && pageSize !== undefined ? { pageSize } : {}),
        ...(storageKey
          ? {
              onShowSizeChange: (current: number, size: number) => {
                if (existingOnShowSizeChange) existingOnShowSizeChange(current, size);
                setPageSize(size);
                writeStoredPageSize(storageKey, size);
              },
            }
          : {}),
      };

  // 列数量变化（如权限导致列增减）时：顺序长度不匹配则重置；隐藏集合剔除越界下标
  useEffect(() => {
    setOrder((prev) => {
      if (prev.length === columns.length) return prev;
      return readStoredOrder(storageKey, columns) ?? columns.map((_, i) => i);
    });
    setHidden((prev) => {
      const valid = [...prev].filter((i) => i < columns.length);
      if (valid.length === prev.size) return prev;
      const next = new Set(valid);
      writeStoredHidden(storageKeyRef.current, next);
      return next;
    });
  }, [columns, storageKey]);

  // 可见列（按顺序过滤掉隐藏列）
  const displayIndices = order.filter((i) => !hidden.has(i));
  const orderedCols = displayIndices.map((i) => columns[i]).filter(Boolean) as NonNullable<TableProps<T>['columns']>;

  // 隐藏列下标 -> 可见序中的位置映射（用于拖拽时把目标映射回可见队列）
  const reorder = (fromVisible: number, toVisible: number) => {
    if (fromVisible === toVisible) return;
    setOrder((prev) => {
      const hiddenSet = hiddenRef.current;
      const visibleSeq = prev.filter((i) => !hiddenSet.has(i));
      const [moved] = visibleSeq.splice(fromVisible, 1);
      visibleSeq.splice(toVisible, 0, moved);
      const next = rebuildOrder(prev, hiddenSet, visibleSeq);
      writeStoredOrder(storageKeyRef.current, next);
      return next;
    });
  };

  const toggleHidden = (index: number) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      writeStoredHidden(storageKeyRef.current, next);
      return next;
    });
  };

  const showAllColumns = () => {
    setHidden(new Set());
    writeStoredHidden(storageKeyRef.current, new Set());
  };

  const resetView = () => {
    const next = columns.map((_, i) => i);
    setOrder(next);
    writeStoredOrder(storageKeyRef.current, next);
    setHidden(new Set());
    writeStoredHidden(storageKeyRef.current, new Set());
  };

  // 「恢复默认顺序」按钮已集成到右键菜单中，此处不再单独显示顶部按钮栏。
  const resetBar = undefined;

  // 拖拽进行中：用 elementFromPoint 探测指针下的可拖拽表头，返回其列序
  useEffect(() => {
    if (dragState === null) return;

    const resolveTarget = (clientX: number, clientY: number): number | null => {
      const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
      const th = el?.closest?.('th.reorderable-col-header') as HTMLElement | null;
      if (!th) return null;
      const idx = Number(th.dataset.colidx);
      return Number.isInteger(idx) ? idx : null;
    };

    const onMove = (e: PointerEvent) => {
      setPointerPos({ x: e.clientX, y: e.clientY });
      const to = resolveTarget(e.clientX, e.clientY);
      setDragState((s) => (s && s.to !== to ? { ...s, to } : s));
    };

    const end = (e: PointerEvent) => {
      const to = resolveTarget(e.clientX, e.clientY);
      const from = dragFromRef.current;
      if (from !== null && to !== null && to !== from) reorder(from, to);
      dragFromRef.current = null;
      setDragState(null);
      setPointerPos(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragState, columns]);

  const draggableCols = orderedCols?.map((col, index) => {
    const isFixed = !!col?.fixed;
    const isSource = dragState?.from === index;
    const isTarget = dragState?.to === index;
    return {
      ...col,
      onHeaderCell: (cell: any) => {
        const base = col?.onHeaderCell ? col.onHeaderCell(cell) : {};
        const extraClass = [
          isFixed ? '' : 'reorderable-col-header',
          isSource ? 'reorderable-dragging' : '',
          isTarget ? 'reorderable-drop-target' : '',
        ]
          .filter(Boolean)
          .join(' ');
        return {
          ...base,
          draggable: false,
          'data-colidx': String(index),
          className: `${base.className ?? ''} ${extraClass}`.trim(),
          title: '拖拽调整列顺序，右键可显示/隐藏列',
          onPointerDown: (e: React.PointerEvent) => {
            if (isFixed) return;
            if (e.button !== 0) return;
            // 阻止文本选中与浏览器原生拖拽启动，改由 Pointer 方案接管
            e.preventDefault();
            dragFromRef.current = index;
            setDragState({ from: index, to: null });
            setPointerPos({ x: e.clientX, y: e.clientY });
            (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          },
        };
      },
    };
  }) as TableProps<T>['columns'];

  const dragLabel = dragState && dragState.from !== null ? (orderedCols[dragState.from]?.title as string) ?? '' : '';
  const ghost =
    dragState && pointerPos ? (
      <div className="reorderable-drag-ghost" style={{ left: pointerPos.x + 14, top: pointerPos.y + 16 }}>
        {dragLabel}
      </div>
    ) : null;

  const menu = menuPos ? (
    <ColumnVisibilityMenu
      x={menuPos.x}
      y={menuPos.y}
      columns={columns as TableColumnType<any>[]}
      hidden={hidden}
      onToggle={toggleHidden}
      onShowAll={showAllColumns}
      onReset={resetView}
      onClose={() => setMenuPos(null)}
    />
  ) : null;

  return (
    <div
      className="reorderable-table-root"
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuPos({ x: e.clientX, y: e.clientY });
      }}
    >
      <Table<T>
        className={`excel-style-table${className ? ` ${className}` : ''}`}
        columns={draggableCols}
        title={resetBar ? () => resetBar : title}
        pagination={resolvedPagination}
        {...rest}
      />
      {ghost}
      {menu}
    </div>
  );
}