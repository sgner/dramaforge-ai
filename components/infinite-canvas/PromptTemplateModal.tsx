import React, { useState, useCallback, useRef, useEffect } from 'react';
import { X, Search, Plus, Pencil, Trash2, Undo2, Sparkles, Save } from 'lucide-react';
import { useI18n } from '../../i18n';

interface PromptTemplate {
  id: string;
  name: string;
  positive: string;
  negative?: string;
  category: string;
  builtin?: boolean;
  params?: Record<string, string>;
}

interface PromptTemplateCategory {
  id: string;
  name: string;
}

interface PromptTemplateModalProps {
  open: boolean;
  nodeId: string;
  onClose: () => void;
  onApply: (nodeId: string, text: string, mode: 'positive' | 'full') => void;
}

export const PromptTemplateModal: React.FC<PromptTemplateModalProps> = ({
  open,
  nodeId,
  onClose,
  onApply,
}) => {
  const { t } = useI18n();
  const DEFAULT_CATEGORIES: PromptTemplateCategory[] = [
    { id: 'all', name: t('canvasPromptTemplateCategoryAll') },
    { id: 'view', name: t('canvasPromptTemplateCategoryView') },
    { id: 'storyboard', name: t('canvasPromptTemplateCategoryStoryboard') },
    { id: 'character', name: t('canvasPromptTemplateCategoryCharacter') },
    { id: 'product', name: t('canvasPromptTemplateCategoryProduct') },
    { id: 'lighting', name: t('canvasPromptTemplateCategoryLighting') },
    { id: 'mine', name: t('canvasPromptTemplateCategoryMine') },
  ];

  const BUILTIN_TEMPLATES: PromptTemplate[] = [
    { id: 't1', name: t('canvasPromptTemplateT1Name'), positive: 'cinematic lighting, dramatic atmosphere, film grain, 35mm photography', negative: 'blurry, low quality', category: 'lighting', builtin: true },
    { id: 't2', name: t('canvasPromptTemplateT2Name'), positive: 'close-up shot, detailed face, shallow depth of field, bokeh background', category: 'view', builtin: true },
    { id: 't3', name: t('canvasPromptTemplateT3Name'), positive: 'full body shot, standing pose, detailed clothing, studio lighting', category: 'character', builtin: true },
    { id: 't4', name: t('canvasPromptTemplateT4Name'), positive: 'product photography, white background, professional studio lighting, high detail', category: 'product', builtin: true },
    { id: 't5', name: t('canvasPromptTemplateT5Name'), positive: 'storyboard sketch, sequential panels, narrative composition', category: 'storyboard', builtin: true },
    { id: 't6', name: t('canvasPromptTemplateT6Name'), positive: 'natural lighting, golden hour, warm tones, soft shadows', category: 'lighting', builtin: true },
    { id: 't7', name: t('canvasPromptTemplateT7Name'), positive: 'wide angle shot, expansive view, dramatic perspective, landscape', category: 'view', builtin: true },
    { id: 't8', name: t('canvasPromptTemplateT8Name'), positive: 'character design sheet, multiple angles, detailed features, concept art', category: 'character', builtin: true },
  ];

  const [category, setCategory] = useState('all');
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('mine');
  const [editText, setEditText] = useState('');
  const [templates, setTemplates] = useState<PromptTemplate[]>(BUILTIN_TEMPLATES);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setCategory('all');
      setSelectedId('');
      setSearch('');
      setEditing(false);
    }
  }, [open]);

  const filteredTemplates = templates.filter((t) => {
    const matchCategory = category === 'all' || t.category === category;
    const matchSearch =
      !search ||
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.positive.toLowerCase().includes(search.toLowerCase());
    return matchCategory && matchSearch;
  });

  const selected = filteredTemplates.find((t) => t.id === selectedId) || filteredTemplates[0] || null;

  const counts = templates.reduce(
    (map, t) => {
      const cat = t.category || 'mine';
      map[cat] = (map[cat] || 0) + 1;
      map.all += 1;
      return map;
    },
    {} as Record<string, number>
  );

  const handleApply = useCallback(
    (mode: 'positive' | 'full') => {
      if (!selected || !nodeId) return;
      const text = mode === 'full' && selected.negative
        ? `${selected.positive}\n\nNegative: ${selected.negative}`
        : selected.positive;
      onApply(nodeId, text, mode);
      onClose();
    },
    [selected, nodeId, onApply, onClose]
  );

  const handleSaveNew = useCallback(() => {
    const newTemplate: PromptTemplate = {
      id: `tpl_${Date.now()}`,
      name: editName || t('canvasPromptTemplateNewName'),
      positive: editText,
      category: editCategory,
      builtin: false,
    };
    setTemplates((prev) => [...prev, newTemplate]);
    setEditing(false);
    setEditName('');
    setEditText('');
    setEditCategory('mine');
  }, [editName, editText, editCategory]);

  const handleDelete = useCallback(() => {
    if (!selected) return;
    setTemplates((prev) => prev.filter((t) => t.id !== selected.id));
    setSelectedId('');
    setEditing(false);
  }, [selected]);

  if (!open) return null;

  return (
    <div className="prompt-template-modal open" onClick={onClose}>
      <div
        ref={panelRef}
        className="prompt-template-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="prompt-template-head">
          <div>
            <strong>{t('canvasPromptNodeTemplateLib')}</strong>
            <span>{t('canvasPromptTemplateSystemPrompt')}</span>
          </div>
          <button
            type="button"
            className="preview-icon-btn"
            onClick={onClose}
            title={t('canvasApiSettingsClose')}
          >
            <X size={14} />
          </button>
        </div>

        <div className="prompt-template-search">
          <span className="search-icon"><Search size={14} /></span>
          <input
            type="search"
            placeholder={t('canvasPromptTemplateSearchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="prompt-template-cats">
          <div className="prompt-template-nav">
            <div className="prompt-template-tabs">
              {DEFAULT_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={cat.id === category ? 'active' : ''}
                  onClick={() => setCategory(cat.id)}
                >
                  <span>{cat.name}</span>
                  <small>{counts[cat.id] || 0}</small>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="prompt-template-body">
          <div className="prompt-template-list">
            <div className="prompt-template-list-tools">
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  setEditName('');
                  setEditText('');
                  setEditCategory('mine');
                }}
              >
                <Plus size={14} /> {t('canvasPromptTemplateCreateNew')}
              </button>
            </div>
            {filteredTemplates.length ? (
              filteredTemplates.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`prompt-template-card ${item.id === selected?.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedId(item.id);
                    setEditing(false);
                  }}
                >
                  <span className="prompt-template-card-top">
                    <span className="prompt-template-name">{item.name}</span>
                    <span className="prompt-template-source">
                      {item.builtin ? t('canvasPromptTemplateBuiltin') : t('canvasPromptTemplateCategoryMine')}
                    </span>
                  </span>
                  <span className="prompt-template-scene">
                    {item.positive.slice(0, 80)}
                  </span>
                </button>
              ))
            ) : (
              <div className="prompt-template-list-empty">{t('canvasPromptTemplateNoMatch')}</div>
            )}
          </div>

          <div className="prompt-template-detail">
            {selected && !editing ? (
              <>
                <div className="prompt-template-detail-head">
                  <div>
                    <strong>{selected.name}</strong>
                    <span>
                      {DEFAULT_CATEGORIES.find((c) => c.id === selected.category)?.name || t('canvasPromptTemplateCategoryMine')} ·{' '}
                      {selected.builtin ? t('canvasPromptTemplateBuiltinLabel') : t('canvasPromptTemplateCustomLabel')}
                    </span>
                  </div>
                  <div className="prompt-template-icon-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setEditName(selected.name);
                        setEditText(selected.positive);
                        setEditCategory(selected.category);
                      }}
                      title={t('canvasPromptTemplateEditTitle')}
                    >
                      <Pencil size={14} /> {t('canvasPromptTemplateEdit')}
                    </button>
                    {!selected.builtin && (
                      <button
                        type="button"
                        className="danger"
                        onClick={handleDelete}
                        title={t('canvasPromptTemplateDeleteTitle')}
                      >
                        <Trash2 size={14} /> {t('canvasPromptTemplateDelete')}
                      </button>
                    )}
                  </div>
                </div>
                <div className="prompt-template-preview-content">
                  <div className="prompt-template-section">
                    <label>{t('canvasPromptTemplatePositive')}</label>
                    <p>{selected.positive}</p>
                  </div>
                  {selected.negative && (
                    <div className="prompt-template-section">
                      <label>{t('canvasPromptTemplateNegative')}</label>
                      <p>{selected.negative}</p>
                    </div>
                  )}
                </div>
                <div className="prompt-template-actions">
                  <button type="button" onClick={() => handleApply('positive')}>
                    <Undo2 size={14} /> {t('canvasPromptTemplateApplyPositive')}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => handleApply('full')}
                  >
                    <Sparkles size={14} /> {t('canvasPromptTemplateApplyFull')}
                  </button>
                </div>
              </>
            ) : editing ? (
              <>
                <div className="prompt-template-detail-head">
                  <div>
                    <strong>{editName ? t('canvasPromptTemplateEditLabel') : t('canvasPromptTemplateNewLabel')}</strong>
                  </div>
                </div>
                <div className="prompt-template-edit-fields">
                  <label>{t('canvasPromptTemplateName')}</label>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder={t('canvasPromptTemplateNamePlaceholder')}
                  />
                  <label>{t('canvasPromptTemplateGroup')}</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                  >
                    {DEFAULT_CATEGORIES.filter((c) => c.id !== 'all').map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                  <label>{t('canvasPromptTemplateContent')}</label>
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    placeholder={t('canvasPromptTemplateContentPlaceholder')}
                    rows={6}
                  />
                </div>
                <div className="prompt-template-actions">
                  <button type="button" onClick={() => setEditing(false)}>
                    {t('canvasGateCancel')}
                  </button>
                  <button type="button" className="primary" onClick={handleSaveNew}>
                    <Save size={14} /> {t('canvasApiSettingsSave')}
                  </button>
                </div>
              </>
            ) : (
              <div className="prompt-template-empty">{t('canvasPromptTemplateEmptyDetail')}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

PromptTemplateModal.displayName = 'PromptTemplateModal';
