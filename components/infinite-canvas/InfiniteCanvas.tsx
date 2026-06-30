import React, {
  useCallback,
  useRef,
  useEffect,
  useState,
  useMemo,
} from 'react';
import { Package, Download, Trash2, X } from 'lucide-react';
import { useCanvasStore } from './use-canvas-store';
import { CanvasNodeComponent } from './CanvasNode';
import { CanvasLinks } from './CanvasLinks';
import { CanvasMiniMap } from './CanvasMiniMap';
import { CreateMenu } from './CreateMenu';
import { CanvasToolbar } from './CanvasToolbar';
import { ZoomControls } from './ZoomControls';
import { OutputLightbox } from './OutputLightbox';
import { ImageNodeMenu } from './ImageNodeMenu';
import { LinkCreateMenu } from './LinkCreateMenu';
import { PromptTemplateModal } from './PromptTemplateModal';
import { ErrorModal } from './ErrorModal';
import { CanvasLogModal } from './CanvasLogModal';
import { CanvasAssetPanel } from './CanvasAssetPanel';
import { ImageEditModal } from './ImageEditModal';
import { ApiSettingsModal } from './ApiSettingsModal';
import { ComposerPanel } from './ComposerPanel';
import {
  screenToWorld,
  applyViewportTransform,
  zoomAtPoint,
  portPoint,
  cubicPoint,
  segmentsIntersect,
  isEditableTarget,
  isNodeControl,
  isNodeDragSurface,
  centerViewportOnWorldPoint,
  estimatedNodeRect,
  minimapBounds,
} from './engine';
import { KnifePoint, CanvasNode, Connection, uid } from './types';
import { createNode } from './use-canvas-store';
import { useI18n } from '../../i18n';
import './canvas.css';

export const InfiniteCanvas: React.FC<{ onBack?: () => void; projectId?: string }> = React.memo(({ onBack, projectId }) => {
  const boardRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const nodes = useCanvasStore((s) => s.nodes);
  const connections = useCanvasStore((s) => s.connections);
  const viewport = useCanvasStore((s) => s.viewport);
  const selected = useCanvasStore((s) => s.selected);
  const theme = useCanvasStore((s) => s.theme);

  const setViewport = useCanvasStore((s) => s.setViewport);
  const moveNode = useCanvasStore((s) => s.moveNode);
  const resizeNode = useCanvasStore((s) => s.resizeNode);
  const addConnection = useCanvasStore((s) => s.addConnection);
  const removeConnection = useCanvasStore((s) => s.removeConnection);
  const removeNodes = useCanvasStore((s) => s.removeNodes);
  const select = useCanvasStore((s) => s.select);
  const clearSelection = useCanvasStore((s) => s.clearSelection);
  const toggleSelect = useCanvasStore((s) => s.toggleSelect);
  const pushUndo = useCanvasStore((s) => s.pushUndo);
  const performUndo = useCanvasStore((s) => s.performUndo);
  const copySelected = useCanvasStore((s) => s.copySelected);
  const pasteNodes = useCanvasStore((s) => s.pasteNodes);
  const addNode = useCanvasStore((s) => s.addNode);
  const groupSelectedNodes = useCanvasStore((s) => s.groupSelectedNodes);
  const toggleAssetPanel = useCanvasStore((s) => s.toggleAssetPanel);
  const assetPanelOpen = useCanvasStore((s) => s.assetPanelOpen);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const apiConfig = useCanvasStore((s) => s.apiConfig);
  const setApiConfig = useCanvasStore((s) => s.setApiConfig);
  const loadProject = useCanvasStore((s) => s.loadProject);

  // Load project data when projectId changes
  useEffect(() => {
    if (projectId) {
      loadProject(projectId);
    }
  }, [projectId, loadProject]);

  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [knifeMode, setKnifeMode] = useState(false);
  const [knifeTrail, setKnifeTrail] = useState<KnifePoint[]>([]);
  const [tempLink, setTempLink] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);
  const [createMenu, setCreateMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
  }>({ open: false, x: 0, y: 0 });
  const [selectionBox, setSelectionBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const [dropOverlayActive, setDropOverlayActive] = useState(false);
  const [lightbox, setLightbox] = useState<{
    open: boolean;
    images: { url: string; name?: string; width?: number; height?: number; prompt?: string }[];
    index: number;
  }>({ open: false, images: [], index: 0 });
  const [imageNodeMenu, setImageNodeMenu] = useState<{
    open: boolean;
    x: number;
    y: number;
    nodeId: string;
  }>({ open: false, x: 0, y: 0, nodeId: '' });
  const [apiSettings, setApiSettings] = useState<{
    open: boolean;
    nodeId: string;
  }>({ open: false, nodeId: '' });
  const [errorModal, setErrorModal] = useState<{
    open: boolean;
    title: string;
    message: string;
  }>({ open: false, title: '', message: '' });
  const [logModal, setLogModal] = useState<{
    open: boolean;
    logs: { id: string; time: string; message: string; status?: 'success' | 'error' | 'pending' }[];
  }>({ open: false, logs: [] });
  const [imageEdit, setImageEdit] = useState<{
    open: boolean;
    imageUrl: string;
    nodeId: string;
  }>({ open: false, imageUrl: '', nodeId: '' });
  const [promptTemplate, setPromptTemplate] = useState<{
    open: boolean;
    nodeId: string;
  }>({ open: false, nodeId: '' });
  const dragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    nodeX: number;
    nodeY: number;
    moved: boolean;
  } | null>(null);
  const resizeRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);
  const panRef = useRef<{
    startX: number;
    startY: number;
    vpX: number;
    vpY: number;
  } | null>(null);
  const selectRef = useRef<{
    startX: number;
    startY: number;
  } | null>(null);
  const linkRef = useRef<{
    fromId: string;
    kind: 'in' | 'out';
  } | null>(null);
  const rKeyRef = useRef(false);

  const getBoardRect = useCallback(() => {
    return boardRef.current?.getBoundingClientRect() || null;
  }, []);

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      const rect = getBoardRect();
      if (!rect) return;
      const newVp = zoomAtPoint(
        e.clientX,
        e.clientY,
        rect,
        viewport,
        e.deltaY
      );
      setViewport(newVp);
    },
    [viewport, setViewport, getBoardRect]
  );

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleBoardMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        panRef.current = {
          startX: e.clientX,
          startY: e.clientY,
          vpX: viewport.x,
          vpY: viewport.y,
        };
        setPanning(true);
        return;
      }
      if (e.button !== 0) return;

      if (knifeMode) {
        const rect = getBoardRect();
        if (rect) {
          const wp = screenToWorld(e.clientX, e.clientY, rect, viewport);
          setKnifeTrail([wp]);
        }
        return;
      }

      if (document.activeElement && document.activeElement !== document.body) {
        (document.activeElement as HTMLElement).blur();
      }

      const target = e.target as HTMLElement;
      if (target !== boardRef.current && target !== worldRef.current) return;

      setCreateMenu({ open: false, x: 0, y: 0 });

      if (rKeyRef.current || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        selectRef.current = { startX: e.clientX, startY: e.clientY };
        setSelecting(true);
        return;
      }

      if (selected.size) {
        clearSelection();
      }

      panRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        vpX: viewport.x,
        vpY: viewport.y,
      };
      setPanning(true);
    },
    [
      viewport,
      knifeMode,
      selected,
      clearSelection,
      getBoardRect,
    ]
  );

  const handleBoardDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target !== boardRef.current && target !== worldRef.current) return;
      setCreateMenu({ open: true, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleFitView = useCallback(() => {
    const rect = getBoardRect();
    if (!rect || !nodes.length) return;
    const bounds = minimapBounds(nodes, rect, viewport);
    const cx = bounds.x + bounds.w / 2;
    const cy = bounds.y + bounds.h / 2;
    const newScale = Math.min(
      rect.width / bounds.w,
      rect.height / bounds.h,
      1.5
    );
    setViewport({
      scale: newScale,
      x: rect.width / 2 - cx * newScale,
      y: rect.height / 2 - cy * newScale,
    });
  }, [nodes, viewport, setViewport, getBoardRect]);

  const handleNodeDragStart = useCallback(
    (id: string, e: React.MouseEvent) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      pushUndo();
      dragRef.current = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        nodeX: node.x,
        nodeY: node.y,
        moved: false,
      };
      setDragging(true);

      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd+点击：切换选中
        toggleSelect(id);
      } else if (!selected.has(id)) {
        select([id]);
      }
    },
    [nodes, selected, select, toggleSelect, pushUndo]
  );

  const handleNodeResizeStart = useCallback(
    (id: string, e: React.MouseEvent) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      pushUndo();
      resizeRef.current = {
        id,
        startX: e.clientX,
        startY: e.clientY,
        startW: node.w,
        startH: node.h || 160,
      };
      setResizing(true);
    },
    [nodes, pushUndo]
  );

  const handlePortMouseDown = useCallback(
    (id: string, kind: 'in' | 'out', e: React.MouseEvent) => {
      e.stopPropagation();
      const node = nodes.find((n) => n.id === id);
      if (!node) return;
      const pp = portPoint(node, kind);
      linkRef.current = { fromId: id, kind };
      setTempLink({
        x1: pp.x,
        y1: pp.y,
        x2: pp.x,
        y2: pp.y,
      });
    },
    [nodes]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const rect = getBoardRect();
      if (!rect) return;

      if (panRef.current) {
        const dx = e.clientX - panRef.current.startX;
        const dy = e.clientY - panRef.current.startY;
        setViewport({
          ...viewport,
          x: panRef.current.vpX + dx,
          y: panRef.current.vpY + dy,
        });
        return;
      }

      if (dragRef.current) {
        const dx =
          (e.clientX - dragRef.current.startX) / viewport.scale;
        const dy =
          (e.clientY - dragRef.current.startY) / viewport.scale;
        const newX = dragRef.current.nodeX + dx;
        const newY = dragRef.current.nodeY + dy;

        if (selected.size > 1 && selected.has(dragRef.current.id)) {
          const origDx = newX - dragRef.current.nodeX;
          const origDy = newY - dragRef.current.nodeY;
          nodes.forEach((n) => {
            if (selected.has(n.id) && n.id !== dragRef.current!.id) {
              moveNode(n.id, n.x + origDx, n.y + origDy);
            }
          });
        }

        moveNode(dragRef.current.id, newX, newY);
        dragRef.current.moved = true;
        return;
      }

      if (resizeRef.current) {
        const dx =
          (e.clientX - resizeRef.current.startX) / viewport.scale;
        const dy =
          (e.clientY - resizeRef.current.startY) / viewport.scale;
        resizeNode(
          resizeRef.current.id,
          Math.max(220, resizeRef.current.startW + dx),
          Math.max(96, resizeRef.current.startH + dy)
        );
        return;
      }

      if (selectRef.current) {
        const left = Math.min(selectRef.current.startX, e.clientX);
        const top = Math.min(selectRef.current.startY, e.clientY);
        const width = Math.abs(e.clientX - selectRef.current.startX);
        const height = Math.abs(e.clientY - selectRef.current.startY);
        setSelectionBox({ left, top, width, height });
        return;
      }

      if (linkRef.current) {
        const wp = screenToWorld(e.clientX, e.clientY, rect, viewport);
        const fromNode = nodes.find((n) => n.id === linkRef.current!.fromId);
        if (fromNode) {
          const pp = portPoint(fromNode, linkRef.current.kind);
          setTempLink({
            x1: pp.x,
            y1: pp.y,
            x2: wp.x,
            y2: wp.y,
          });
        }
        return;
      }

      if (knifeMode && knifeTrail.length > 0) {
        const wp = screenToWorld(e.clientX, e.clientY, rect, viewport);
        setKnifeTrail((prev) => [...prev, wp]);
      }
    };

    const onUp = (e: MouseEvent) => {
      if (panRef.current) {
        panRef.current = null;
        setPanning(false);
      }

      if (dragRef.current) {
        // 仅在拖拽移动过时才处理，选中逻辑已在mousedown中完成
        const draggedId = dragRef.current.id;
        dragRef.current = null;
        setDragging(false);
        // 记录 agent_node 拖动偏移，供后续 addAgentNodes 使用
        // 使用 getState() 读取最新 nodes，避免 useEffect 闭包内可能存在的 stale nodes 风险
        const liveNodes = useCanvasStore.getState().nodes;
        const draggedNode = liveNodes.find((n) => n.id === draggedId);
        if (draggedNode && draggedNode.type === 'agent_node') {
          useCanvasStore.getState().recordAgentNodeDrag(draggedId, draggedNode.x, draggedNode.y);
        }
      }

      if (resizeRef.current) {
        resizeRef.current = null;
        setResizing(false);
      }

      if (selectRef.current) {
        const rect = getBoardRect();
        if (rect && selectionBox) {
          const vp = viewport;
          const boxLeft = (selectionBox.left - rect.left - vp.x) / vp.scale;
          const boxTop = (selectionBox.top - rect.top - vp.y) / vp.scale;
          const boxW = selectionBox.width / vp.scale;
          const boxH = selectionBox.height / vp.scale;

          const inside = nodes.filter((n) => {
            const nr = estimatedNodeRect(n);
            return (
              nr.x >= boxLeft &&
              nr.y >= boxTop &&
              nr.x + nr.w <= boxLeft + boxW &&
              nr.y + nr.h <= boxTop + boxH
            );
          });
          if (inside.length) {
            select(inside.map((n) => n.id));
          }
        }
        selectRef.current = null;
        setSelecting(false);
        setSelectionBox(null);
      }

      if (linkRef.current) {
        const target = e.target as HTMLElement;
        const nodeEl = target.closest('.image-node');
        if (nodeEl) {
          const toId = nodeEl.getAttribute('data-id');
          if (toId && toId !== linkRef.current.fromId) {
            const existing = connections.find(
              (c) =>
                (c.from === linkRef.current!.fromId && c.to === toId) ||
                (c.from === toId && c.to === linkRef.current!.fromId)
            );
            if (!existing) {
              pushUndo();
              if (linkRef.current.kind === 'out') {
                addConnection(linkRef.current.fromId, toId);
              } else {
                addConnection(toId, linkRef.current.fromId);
              }
            }
          }
        }
        linkRef.current = null;
        setTempLink(null);
      }

      if (knifeMode && knifeTrail.length > 1) {
        const toDelete: string[] = [];
        connections.forEach((c) => {
          const fromNode = nodes.find((n) => n.id === c.from);
          const toNode = nodes.find((n) => n.id === c.to);
          if (!fromNode || !toNode) return;
          const a = portPoint(fromNode, 'out');
          const b = portPoint(toNode, 'in');
          for (let i = 0; i < knifeTrail.length - 1; i++) {
            if (
              segmentsIntersect(
                knifeTrail[i],
                knifeTrail[i + 1],
                a,
                b
              )
            ) {
              toDelete.push(c.id);
              break;
            }
          }
        });
        if (toDelete.length) {
          pushUndo();
          toDelete.forEach((id) => removeConnection(id));
        }
        setKnifeTrail([]);
      }
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [
    viewport,
    nodes,
    connections,
    knifeMode,
    knifeTrail,
    selectionBox,
    getBoardRect,
    setViewport,
    moveNode,
    resizeNode,
    select,
    toggleSelect,
    addConnection,
    removeConnection,
    pushUndo,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      if (e.key === 'r' || e.key === 'R') {
        rKeyRef.current = true;
      }

      if (e.key === 'Shift') {
        setKnifeMode(true);
        setKnifeTrail([]);
      }

      if (e.key === 'k' || e.key === 'K') {
        setKnifeMode((prev) => !prev);
        setKnifeTrail([]);
      }

      if (e.key === 'f' || e.key === 'F') {
        handleFitView();
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
        pushUndo();
        removeNodes([...selected]);
      }

      if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        performUndo();
      }

      if (e.key === 'g' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        pushUndo();
        groupSelectedNodes();
      }

      if (e.key === 'c' && (e.ctrlKey || e.metaKey) && selected.size) {
        copySelected();
      }

      if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
        const rect = getBoardRect();
        if (rect) {
          const center = {
            x: (-viewport.x + rect.width / 2) / viewport.scale,
            y: (-viewport.y + rect.height / 2) / viewport.scale,
          };
          pasteNodes(center);
        }
      }

      if (e.key === 'a' || e.key === 'A') {
        if (!e.ctrlKey && !e.metaKey) {
          toggleAssetPanel();
        }
      }

      if (e.key === 'z' && !e.ctrlKey && !e.metaKey) {
        const rect = getBoardRect();
        if (rect) {
          const newScale = Math.max(0.1, viewport.scale / 1.2);
          setViewport({
            ...viewport,
            scale: newScale,
            x: rect.width / 2 - (rect.width / 2 - viewport.x) * (newScale / viewport.scale),
            y: rect.height / 2 - (rect.height / 2 - viewport.y) * (newScale / viewport.scale),
          });
        }
      }

      if (e.key === 'Escape') {
        setCreateMenu({ open: false, x: 0, y: 0 });
        setKnifeMode(false);
        setKnifeTrail([]);
        clearSelection();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        rKeyRef.current = false;
      }
      if (e.key === 'Shift') {
        setKnifeMode(false);
        setKnifeTrail([]);
      }
    };

    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (!file) continue;
          const url = URL.createObjectURL(file);
          const rect = getBoardRect();
          const point = rect
            ? {
                x: (-viewport.x + rect.width / 2) / viewport.scale,
                y: (-viewport.y + rect.height / 2) / viewport.scale,
              }
            : { x: 0, y: 0 };
          addNode(
            createNode('image', point, {
              url,
              name: file.name,
              mediaKind: 'image',
            })
          );
          break;
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('paste', onPaste);
    };
  }, [selected, viewport, pushUndo, removeNodes, performUndo, copySelected, pasteNodes, clearSelection, getBoardRect, groupSelectedNodes, toggleAssetPanel, addNode, handleFitView, setViewport]);

  const handleLinkDelete = useCallback(
    (id: string) => {
      pushUndo();
      removeConnection(id);
    },
    [pushUndo, removeConnection]
  );

  const handleToggleKnife = useCallback(() => {
    setKnifeMode((prev) => !prev);
    setKnifeTrail([]);
  }, []);

  const handleNodeDoubleClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;

      if (node.type === 'image' && node.url) {
        setLightbox({
          open: true,
          images: [{ url: node.url, name: node.name as string | undefined }],
          index: 0,
        });
      } else if (node.type === 'group' && node.items?.length) {
        const groupImages = node.items
          .map((itemId) => nodes.find((n) => n.id === itemId))
          .filter((n): n is CanvasNode => !!n && n.type === 'image' && !!n.url)
          .map((n) => ({ url: n.url!, name: n.name as string | undefined }));
        if (groupImages.length) {
          setLightbox({ open: true, images: groupImages, index: 0 });
        }
      }
    },
    [nodes]
  );

  const handleNodeContextMenu = useCallback(
    (id: string, e: React.MouseEvent) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return;

      if (node.type === 'image' || node.type === 'video') {
        setImageNodeMenu({ open: true, x: e.clientX, y: e.clientY, nodeId: id });
      }
    },
    [nodes]
  );

  const worldStyle: React.CSSProperties = {
    transform: applyViewportTransform(viewport),
  };

  const rootClass = [
    'canvas-root',
    `theme-${theme}`,
    panning ? 'panning' : '',
    dragging ? 'node-dragging' : '',
    resizing ? 'node-resizing' : '',
    selecting ? 'selecting' : '',
    knifeMode ? 'knife' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} ref={boardRef}
      onMouseDown={handleBoardMouseDown}
      onDoubleClick={handleBoardDoubleClick}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropOverlayActive(true);
      }}
      onDragLeave={() => setDropOverlayActive(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropOverlayActive(false);
        const files = [...e.dataTransfer.files].filter((f) =>
          f.type.startsWith('image/')
        );
        if (!files.length) return;
        const rect = getBoardRect();
        const point = rect
          ? screenToWorld(e.clientX, e.clientY, rect, viewport)
          : { x: 0, y: 0 };
        files.forEach((file, i) => {
          const url = URL.createObjectURL(file);
          addNode(
            createNode('image', { x: point.x + i * 36, y: point.y + i * 36 }, {
              url,
              name: file.name,
              mediaKind: 'image',
            })
          );
        });
      }}
    >
      <CanvasToolbar
          onUndo={performUndo}
          onFitView={handleFitView}
          knifeMode={knifeMode}
          onToggleKnife={handleToggleKnife}
          onOpenApiSettings={() => setApiSettings({ open: true })}
          onBack={onBack}
        />

      <div ref={worldRef} className="canvas-world" style={worldStyle}>
        <CanvasLinks
          nodes={nodes}
          connections={connections}
          tempLink={tempLink}
          knifeTrail={knifeTrail}
          hoveredLink={hoveredLink}
          onLinkHover={setHoveredLink}
          onLinkDelete={handleLinkDelete}
        />

        {nodes.map((node) => (
          <CanvasNodeComponent
            key={node.id}
            node={node}
            onDragStart={handleNodeDragStart}
            onResizeStart={handleNodeResizeStart}
            onPortMouseDown={handlePortMouseDown}
            onNodeDoubleClick={handleNodeDoubleClick}
            onNodeContextMenu={handleNodeContextMenu}
            onOpenTemplate={(nodeId) => setPromptTemplate({ open: true, nodeId })}
          />
        ))}

        <ComposerPanel />
      </div>

      {selectionBox && (
        <div
          className="selection-box"
          style={{
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.width,
            height: selectionBox.height,
            display: 'block',
          }}
        />
      )}

      <div className={`drop-overlay${dropOverlayActive ? ' active' : ''}`}>
        {t('canvasDropHint')}
      </div>

      <CreateMenu
        open={createMenu.open}
        x={createMenu.x}
        y={createMenu.y}
        boardRect={getBoardRect()}
        onClose={() => setCreateMenu({ open: false, x: 0, y: 0 })}
      />

      <CanvasMiniMap />
      <ZoomControls />

      <OutputLightbox
        open={lightbox.open}
        images={lightbox.images}
        initialIndex={lightbox.index}
        onClose={() => setLightbox({ open: false, images: [], index: 0 })}
      />

      <ImageNodeMenu
        open={imageNodeMenu.open}
        x={imageNodeMenu.x}
        y={imageNodeMenu.y}
        nodeId={imageNodeMenu.nodeId}
        nodeUrl={(() => {
          const n = nodes.find((n) => n.id === imageNodeMenu.nodeId);
          return n?.url;
        })()}
        nodeName={(() => {
          const n = nodes.find((n) => n.id === imageNodeMenu.nodeId);
          return n?.name as string | undefined;
        })()}
        nodePrompt={(() => {
          const n = nodes.find((n) => n.id === imageNodeMenu.nodeId);
          return n?._assetPrompt as string | undefined;
        })()}
        nodeProviderName={(() => {
          const n = nodes.find((n) => n.id === imageNodeMenu.nodeId);
          return n?._assetProviderName as string | undefined;
        })()}
        nodeModelId={(() => {
          const n = nodes.find((n) => n.id === imageNodeMenu.nodeId);
          return n?._assetModelId as string | undefined;
        })()}
        nodeAssetKind={(() => {
          const n = nodes.find((n) => n.id === imageNodeMenu.nodeId);
          return n?._assetKind as string | undefined;
        })()}
        onClose={() => setImageNodeMenu({ open: false, x: 0, y: 0, nodeId: '' })}
        onPreview={() => {
          const node = nodes.find((n) => n.id === imageNodeMenu.nodeId);
          if (node?.url) {
            setLightbox({ open: true, images: [{ url: node.url, name: node.name as string | undefined }], index: 0 });
          }
        }}
        onEdit={() => {
          const node = nodes.find((n) => n.id === imageNodeMenu.nodeId);
          if (node?.url) {
            setImageEdit({ open: true, imageUrl: node.url, nodeId: node.id });
          }
        }}
        onDelete={() => {
          pushUndo();
          removeNodes([imageNodeMenu.nodeId]);
        }}
      />

      <CanvasAssetPanel
        open={assetPanelOpen}
        onClose={() => toggleAssetPanel()}
        onAddToCanvas={(item) => {
          const rect = getBoardRect();
          const point = rect
            ? {
                x: (-viewport.x + rect.width / 2) / viewport.scale,
                y: (-viewport.y + rect.height / 2) / viewport.scale,
              }
            : { x: 0, y: 0 };

          if (item.kind === 'text') {
            // 文本资产：根据 assetKind 创建专用渲染器节点
            const nodeType: 'novel' | 'script' = item.assetKind === 'novel' ? 'novel' : 'script';
            addNode(
              createNode(nodeType, point, {
                text: item.prompt || '',
                title: item.name,
                _assetKind: item.assetKind,
                _assetProviderName: item.providerName,
                _assetModelId: item.modelId,
              })
            );
          } else if (item.url) {
            // 图片/视频资产
            addNode(
              createNode('image', point, {
                url: item.url,
                name: item.name,
                mediaKind: item.kind || 'image',
                _assetKind: item.assetKind,
                _assetPrompt: item.prompt,
                _assetProviderName: item.providerName,
                _assetModelId: item.modelId,
              })
            );
          }
        }}
      />

      <PromptTemplateModal
        open={promptTemplate.open}
        nodeId={promptTemplate.nodeId}
        onClose={() => setPromptTemplate({ open: false, nodeId: '' })}
        onApply={(nodeId, text) => {
          const node = nodes.find((n) => n.id === nodeId);
          if (node) {
            updateNode(nodeId, { text });
          }
        }}
      />

      <ErrorModal
        open={errorModal.open}
        title={errorModal.title}
        message={errorModal.message}
        onClose={() => setErrorModal({ open: false, title: '', message: '' })}
      />

      <CanvasLogModal
        open={logModal.open}
        logs={logModal.logs}
        onClose={() => setLogModal({ open: false, logs: [] })}
      />

      <ImageEditModal
        open={imageEdit.open}
        imageUrl={imageEdit.imageUrl}
        onClose={() => setImageEdit({ open: false, imageUrl: '', nodeId: '' })}
        onApply={(resultUrl) => {
          updateNode(imageEdit.nodeId, { url: resultUrl });
          setImageEdit({ open: false, imageUrl: '', nodeId: '' });
        }}
      />

      <ApiSettingsModal
        open={apiSettings.open}
        onClose={() => setApiSettings({ open: false })}
        config={apiConfig}
        onSave={setApiConfig}
      />

      {selected.size > 1 && (
        <div className="multi-select-bar">
          <span className="multi-select-count">{t('canvasMultiSelectCount').replace('{0}', String(selected.size))}</span>
          <button className="multi-select-btn" type="button" onClick={() => {
            const selectedNodes = nodes.filter(n => selected.has(n.id));
            if (selectedNodes.length < 2) return;
            const minX = Math.min(...selectedNodes.map(n => n.x));
            const minY = Math.min(...selectedNodes.map(n => n.y));
            const groupId = uid('grp');
            const groupNode: CanvasNode = {
              id: groupId,
              type: 'group',
              x: minX - 20,
              y: minY - 20,
              w: 300,
              items: selectedNodes.map(n => n.id),
              title: t('canvasNodeGroup'),
            };
            addNode(groupNode);
          }}>
            <Package size={14} /> {t('canvasNodeGroupSelected')}
          </button>
          <button className="multi-select-btn" type="button" onClick={() => {
            const selectedNodes = nodes.filter(n => selected.has(n.id));
            selectedNodes.forEach(n => {
              if (n.type === 'image' && n.url) {
                const a = document.createElement('a');
                a.href = n.url;
                a.download = (n.name as string) || 'image.png';
                a.click();
              }
            });
          }}>
            <Download size={14} /> {t('canvasDownloadImage')}
          </button>
          <button className="multi-select-btn danger" type="button" onClick={() => removeNodes([...selected])}>
            <Trash2 size={14} /> {t('canvasNodeDelete')}
          </button>
          <button className="multi-select-btn" type="button" onClick={() => clearSelection()}>
            <X size={14} /> {t('canvasNodeDeselect')}
          </button>
        </div>
      )}

      <div className="canvas-hint">
        {t('canvasComposerHint')}
      </div>
    </div>
  );
});

InfiniteCanvas.displayName = 'InfiniteCanvas';
