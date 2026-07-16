import { useState, useEffect, useCallback } from 'react';
import { promptTemplates, PromptTemplateOut } from '../services/apiClient';
import './PromptLibraryPanel.css';

const CATEGORIES = [
  { id: '', name: '全部' },
  { id: 'view', name: '视角' },
  { id: 'storyboard', name: '分镜' },
  { id: 'character', name: '角色' },
  { id: 'product', name: '产品' },
  { id: 'lighting', name: '光影' },
  { id: 'custom', name: '自定义' },
];

const CATEGORY_LABELS: Record<string, string> = {
  view: '视角', storyboard: '分镜', character: '角色',
  product: '产品', lighting: '光影', custom: '自定义',
};

interface PromptLibraryPanelProps {
  onInsert: (template: PromptTemplateOut) => void;
}

export function PromptLibraryPanel({ onInsert }: PromptLibraryPanelProps) {
  const [templates, setTemplates] = useState<PromptTemplateOut[]>([]);
  const [activeCategory, setActiveCategory] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<PromptTemplateOut | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const load = useCallback(async (cat: string) => {
    const items = await promptTemplates.list(cat || undefined);
    setTemplates(items);
  }, []);

  useEffect(() => {
    load(activeCategory);
  }, [activeCategory, load]);

  const filtered = search
    ? templates.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.scene.toLowerCase().includes(search.toLowerCase()) ||
        t.positive.toLowerCase().includes(search.toLowerCase())
      )
    : templates;

  const handleSave = async (data: Partial<PromptTemplateOut>) => {
    if (isCreating) {
      await promptTemplates.create(data as any);
    } else if (editing) {
      await promptTemplates.update(editing.id, data);
    }
    setEditing(null);
    setIsCreating(false);
    await load(activeCategory);
  };

  const handleDelete = async (id: string) => {
    await promptTemplates.remove(id);
    await load(activeCategory);
  };

  return (
    <div className="prompt-library-panel" data-testid="prompt-library-panel">
      <div className="plp-header">
        <input
          className="plp-search"
          type="text"
          placeholder="搜索..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="plp-categories">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            className={`plp-cat-btn ${activeCategory === cat.id ? 'active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>
      <div className="plp-list">
        {filtered.map(t => (
          <div key={t.id} className="plp-card">
            <div className="plp-card-header">
              <span className="plp-card-name">{t.name}</span>
              <div className="plp-card-badges">
                <span className="plp-cat-badge">{CATEGORY_LABELS[t.category] || t.category}</span>
                {t.is_builtin && <span className="plp-builtin-badge">内置</span>}
              </div>
            </div>
            <div className="plp-card-scene">{t.scene}</div>
            <div className="plp-card-actions">
              <button onClick={() => setEditing(t)}>编辑</button>
              <button onClick={() => onInsert(t)}>插入</button>
              {!t.is_builtin && <button onClick={() => handleDelete(t.id)}>删除</button>}
            </div>
          </div>
        ))}
      </div>
      <button className="plp-new-btn" onClick={() => setIsCreating(true)}>新建模板</button>
      {(editing || isCreating) && (
        <TemplateEditor
          template={editing}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setIsCreating(false); }}
        />
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  onSave,
  onCancel,
}: {
  template: PromptTemplateOut | null;
  onSave: (data: Partial<PromptTemplateOut>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template?.name || '');
  const [category, setCategory] = useState(template?.category || 'custom');
  const [scene, setScene] = useState(template?.scene || '');
  const [positive, setPositive] = useState(template?.positive || '');
  const [negative, setNegative] = useState(template?.negative || '');

  return (
    <div className="plp-editor" data-testid="plp-editor">
      <div className="plp-editor-row">
        <label htmlFor="plp-editor-name">名称</label>
        <input id="plp-editor-name" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="plp-editor-row">
        <label htmlFor="plp-editor-category">分类</label>
        <select id="plp-editor-category" value={category} onChange={e => setCategory(e.target.value)}>
          {CATEGORIES.filter(c => c.id).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="plp-editor-row">
        <label htmlFor="plp-editor-scene">适用场景</label>
        <input id="plp-editor-scene" value={scene} onChange={e => setScene(e.target.value)} />
      </div>
      <div className="plp-editor-row">
        <label htmlFor="plp-editor-positive">正向提示词</label>
        <textarea id="plp-editor-positive" value={positive} onChange={e => setPositive(e.target.value)} rows={4} />
      </div>
      <div className="plp-editor-row">
        <label htmlFor="plp-editor-negative">负向提示词</label>
        <textarea id="plp-editor-negative" value={negative} onChange={e => setNegative(e.target.value)} rows={3} />
      </div>
      <div className="plp-editor-actions">
        <button onClick={() => onSave({ name, category, scene, positive, negative })}>保存</button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}
