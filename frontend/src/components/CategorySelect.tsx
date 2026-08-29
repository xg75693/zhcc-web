import { useCallback, useEffect, useId, useRef, useState } from 'react';

interface Props {
  /** 类别名称列表（不含「全部类别」） */
  options: string[];
  /** 当前选中的类别名；空串表示「全部类别」 */
  value: string;
  onChange: (value: string) => void;
  /** 点击列表里的「管理」按钮 */
  onManage: () => void;
  disabled?: boolean;
  disabledTitle?: string;
}

const ALL_LABEL = '全部类别';

/**
 * 类别筛选下拉。
 *
 * 与原生 select 的区别只有一点：展开后第一项「全部类别」的右侧带一个「管理」按钮，
 * 点它直接打开类别管理弹窗——筛选和维护在同一个入口里，不必再去工具栏找按钮。
 * 原生 <option> 塞不进按钮，所以这里用 listbox 手写，交互对齐 SearchableSelect。
 */
export default function CategorySelect({
  options, value, onChange, onManage, disabled = false, disabledTitle = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  // 索引 0 恒为「全部类别」，其后依次是各类别
  const items = ['', ...options];

  const close = useCallback(() => { setOpen(false); setActiveIndex(-1); }, []);

  useEffect(() => { if (disabled) close(); }, [disabled, close]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const commit = (v: string) => { onChange(v); close(); triggerRef.current?.focus(); };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActiveIndex(Math.max(0, items.indexOf(value))); return; }
      const down = e.key === 'ArrowDown';
      setActiveIndex(i => {
        if (i < 0) return down ? 0 : items.length - 1;
        return (i + (down ? 1 : -1) + items.length) % items.length;
      });
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (!open) { e.preventDefault(); setOpen(true); setActiveIndex(Math.max(0, items.indexOf(value))); }
      else if (activeIndex >= 0) { e.preventDefault(); commit(items[activeIndex]); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); close(); }
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    <div className="category-select" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="listbox"
        className="category-select-trigger"
        disabled={disabled}
        title={disabled ? disabledTitle : ''}
        onClick={() => { if (!disabled) { setOpen(o => !o); setActiveIndex(Math.max(0, items.indexOf(value))); } }}
        onKeyDown={handleKeyDown}
      >
        <span className="category-select-value">{value || ALL_LABEL}</span>
        <span className={`category-select-caret${open ? ' open' : ''}`} aria-hidden="true">▾</span>
      </button>

      {open && (
        <ul className="category-select-list" role="listbox" id={listId} ref={listRef} onKeyDown={handleKeyDown}>
          {items.map((name, i) => (
            <li
              key={name || '__all__'}
              role="option"
              aria-selected={name === value}
              className={`category-select-option${i === activeIndex ? ' active' : ''}${name === value ? ' selected' : ''}${i === 0 ? ' with-action' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={e => e.preventDefault()}
              onClick={() => commit(name)}
            >
              <span className="category-select-option-label">{name || ALL_LABEL}</span>
              {i === 0 && (
                // 按钮嵌在选项里，点它是「打开管理」而不是「选中全部类别」，所以要拦下冒泡
                <button
                  type="button"
                  className="category-select-manage"
                  onClick={e => { e.stopPropagation(); close(); onManage(); }}
                >管理</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
