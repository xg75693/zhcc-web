import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

export interface SearchableOption {
  value: string;
  label: string;
  /** 额外参与检索但不显示的关键词，如客户商品编号、规格 */
  keywords?: string;
}

interface Props {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * 可检索下拉框（WAI-ARIA combobox 模式）：
 * 输入即过滤，↑↓ 移动、Enter 选中、Esc 收起，点击外部收起并回显当前选项。
 */
export default function SearchableSelect({
  options, value, onChange, placeholder = '请选择', disabled = false, className = '',
}: Props) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(''); // 输入框实际内容，始终跟随按键（含输入法组合中的拼音）
  const [query, setQuery] = useState('');           // 用于过滤，输入法组合期间不更新
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const selected = options.find(o => o.value === value) || null;

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    if (!kw) return options;
    return options.filter(o =>
      o.value.toLowerCase().includes(kw) ||
      o.label.toLowerCase().includes(kw) ||
      (o.keywords || '').toLowerCase().includes(kw)
    );
  }, [options, query]);

  // 收起时清空关键词，输入框回显当前选中项，避免残留半截检索词
  const close = useCallback(() => {
    setOpen(false); setInputValue(''); setQuery(''); setActiveIndex(-1);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close]);

  // 键盘移动时保持高亮项可见
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const commit = (opt: SearchableOption) => {
    onChange(opt.value);
    close();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    // 输入法组合中的回车是「候选词上屏」，不能当成选中项。
    // 只信浏览器逐事件给出的 isComposing，不自己记状态——否则 compositionend 万一没触发，键盘会永久失效
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActiveIndex(0); return; }
      if (filtered.length === 0) return;
      const down = e.key === 'ArrowDown';
      setActiveIndex(i => {
        if (i < 0) return down ? 0 : filtered.length - 1;
        return (i + (down ? 1 : -1) + filtered.length) % filtered.length;
      });
    } else if (e.key === 'Enter') {
      if (open && filtered[activeIndex]) { e.preventDefault(); commit(filtered[activeIndex]); }
    } else if (e.key === 'Escape') {
      if (open) { e.preventDefault(); close(); }
    } else if (e.key === 'Tab') {
      close();
    }
  };

  return (
    <div className={`searchable-select ${className}`} ref={rootRef}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
        autoComplete="off"
        disabled={disabled}
        className="searchable-select-input"
        value={open ? inputValue : (selected?.label ?? '')}
        placeholder={open ? (selected?.label ?? placeholder) : placeholder}
        onFocus={() => { if (!disabled) setOpen(true); }}
        onChange={e => {
          const v = e.target.value;
          setInputValue(v);
          setOpen(true);
          setActiveIndex(0);
          // 输入法组合中（还在打拼音）先不过滤，否则中文名列表会一路显示「无匹配项」
          if (!(e.nativeEvent as InputEvent).isComposing) setQuery(v);
        }}
        // Safari 的 input 事件早于 compositionend，这里兜底提交最终结果
        onCompositionEnd={e => {
          const v = e.currentTarget.value;
          setInputValue(v); setQuery(v); setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
      />
      {selected && !disabled && (
        <button
          type="button"
          className="searchable-select-clear"
          aria-label="清除选择"
          onClick={() => { onChange(''); close(); inputRef.current?.focus(); }}
        >×</button>
      )}
      {/* 下拉箭头：让它一眼看出来是下拉而不是普通输入框 */}
      <span className={`searchable-select-caret${open ? ' open' : ''}`} aria-hidden="true">▾</span>
      {open && (
        <ul className="searchable-select-list" role="listbox" id={listId} ref={listRef}>
          {filtered.length === 0 && <li className="searchable-select-empty">无匹配项</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value}
              id={`${listId}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`searchable-select-option${i === activeIndex ? ' active' : ''}${o.value === value ? ' selected' : ''}`}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={e => e.preventDefault()}
              onClick={() => commit(o)}
            >{o.label}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
