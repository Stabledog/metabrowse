/** Tree management modal panel with keyboard navigation. */

import type { TreeEntry } from './github.ts';
import { createNode, deleteNode, confirmDeleteNodes, renameNode, moveNode } from './tree-ops.ts';
import { logInfo } from './logging-client.ts';
import { pushModal, popModal } from './modal-stack.ts';
import { errorMessage } from './utils.ts';

interface TreeNode {
  name: string;
  dirPath: string;
  depth: number;
  children: TreeNode[];
  expanded: boolean;
}

interface AppState {
  token: string;
  host: string;
  owner: string;
  repo: string;
  contentPaths: string[];
  tree: TreeEntry[];
}

/**
 * Build a hierarchical tree from flat contentPaths.
 * E.g., ["teach", "teach/CPP", "teach/Python", "research"]
 * → root with children teach, research; teach with children CPP, Python.
 */
/**
 * Collect dirPaths of all expanded nodes in a tree.
 */
function getExpandedPaths(nodes: TreeNode[]): Set<string> {
  const expanded = new Set<string>();
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.expanded) expanded.add(node.dirPath);
      walk(node.children);
    }
  };
  walk(nodes);
  return expanded;
}

function buildTreeNodes(contentPaths: string[], expandedPaths?: Set<string>): TreeNode[] {
  const children: TreeNode[] = [];
  const pathMap: Record<string, TreeNode> = {};

  // Sort so parents always appear before children
  const sorted = contentPaths.filter(p => p !== '').sort();

  for (const dirPath of sorted) {
    const parts = dirPath.split('/');
    const name = parts[parts.length - 1];
    const parentPath = parts.slice(0, -1).join('/');

    const node: TreeNode = {
      name,
      dirPath,
      depth: parts.length,  // depth 1+ (root is 0)
      children: [],
      expanded: expandedPaths ? expandedPaths.has(dirPath) : false,
    };

    pathMap[dirPath] = node;

    if (parentPath === '') {
      children.push(node);
    } else if (pathMap[parentPath]) {
      pathMap[parentPath].children.push(node);
    }
  }

  // Sort at each level
  const sortRecursive = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    for (const node of nodes) {
      sortRecursive(node.children);
    }
  };
  sortRecursive(children);

  // Wrap everything in a synthetic root node so users can insert top-level children
  const rootNode: TreeNode = {
    name: '[root]',
    dirPath: '',
    depth: 0,
    children,
    expanded: true,
  };

  return [rootNode];
}


/**
 * Flatten tree into visible nodes (respecting expand state).
 */
function getVisibleNodes(nodes: TreeNode[]): TreeNode[] {
  const visible: TreeNode[] = [];
  const traverse = (list: TreeNode[]) => {
    for (const node of list) {
      visible.push(node);
      if (node.expanded && node.children.length > 0) {
        traverse(node.children);
      }
    }
  };
  traverse(nodes);
  return visible;
}

/**
 * Expand all ancestor nodes of targetPath so it becomes visible.
 */
function expandToPath(nodes: TreeNode[], targetPath: string): void {
  const parts = targetPath.split('/');
  for (let len = 1; len <= parts.length; len++) {
    const ancestorPath = parts.slice(0, len).join('/');
    const node = findNodeByPath(nodes, ancestorPath);
    if (node && node.children.length > 0) node.expanded = true;
  }
}

function findNodeByPath(nodes: TreeNode[], path: string): TreeNode | undefined {
  for (const node of nodes) {
    if (node.dirPath === path) return node;
    const found = findNodeByPath(node.children, path);
    if (found) return found;
  }
  return undefined;
}

/**
 * Show the tree management panel.
 */
export async function showTreePanel(
  state: AppState,
  refreshTree: () => Promise<string[]>,
  currentDirPath?: string,
): Promise<void> {
  logInfo(`TreePanel: showTreePanel called, contentPaths=${state.contentPaths.length}`);

  const overlay = document.createElement('div');
  overlay.className = 'tree-panel-overlay';

  const panel = document.createElement('div');
  panel.className = 'tree-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'tree-panel-header';
  header.innerHTML = '<div>Tree Manager</div>';

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  closeBtn.className = 'tree-panel-close';
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // Toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'tree-panel-toolbar';
  toolbar.innerHTML = `
    <div>j/k Nav | l Expand | h Collapse | Enter Go</div>
    <div>i/Ins New | dd/Del Delete | F2 Rename | m Move | p Place</div>
    <div>gg Top | u/Esc Close</div>
  `;
  panel.appendChild(toolbar);

  // Path indicator
  const pathBar = document.createElement('div');
  pathBar.className = 'tree-panel-pathbar';
  panel.appendChild(pathBar);

  // Tree list (scrollable)
  const listContainer = document.createElement('div');
  listContainer.className = 'tree-list';
  panel.appendChild(listContainer);

  // Status bar
  const status = document.createElement('div');
  status.className = 'tree-status';
  panel.appendChild(status);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'tree-footer';

  panel.appendChild(footer);

  overlay.appendChild(panel);

  // State
  let treeRoot = buildTreeNodes(state.contentPaths);
  let selectedIndex = 0;
  let inputMode: 'new' | 'rename' | null = null;
  let inputNode: TreeNode | null = null;
  let pendingDelete: { paths: string[] } | null = null;
  let pendingFocusInput: HTMLInputElement | null = null;
  let moveSource: TreeNode | null = null;
  let lastKey = '';

  // Auto-select the current page node
  if (currentDirPath) {
    expandToPath(treeRoot, currentDirPath);
    const visibleForInit = getVisibleNodes(treeRoot);
    const idx = visibleForInit.findIndex(n => n.dirPath === currentDirPath);
    if (idx >= 0) selectedIndex = idx;
  }

  // Render function
  function render() {
    listContainer.innerHTML = '';
    const visible = getVisibleNodes(treeRoot);

    // Update path indicator
    const selNode = visible[selectedIndex];
    pathBar.textContent = selNode?.dirPath
      ? selNode.dirPath.replace(/\//g, ' / ')
      : '[root]';

    for (let i = 0; i < visible.length; i++) {
      const node = visible[i];
      const nodeEl = document.createElement('div');
      let cls = 'tree-node';
      if (i === selectedIndex) cls += ' tree-node-selected';
      if (moveSource && node.dirPath === moveSource.dirPath) cls += ' tree-node-move-source';
      nodeEl.className = cls;
      nodeEl.setAttribute('data-path', node.dirPath);
      nodeEl.style.marginLeft = `${node.depth * 16}px`;

      // Expand icon
      const iconSpan = document.createElement('span');
      iconSpan.className = 'tree-expand-icon';
      iconSpan.textContent = node.children.length === 0 ? '·' : node.expanded ? '▼' : '▶';
      if (node.children.length > 0) {
        iconSpan.classList.add('clickable');
        iconSpan.style.cursor = 'pointer';
        iconSpan.addEventListener('click', (e) => {
          e.stopPropagation();
          node.expanded = !node.expanded;
          selectedIndex = visible.indexOf(node);
          render();
        });
      }
      nodeEl.appendChild(iconSpan);

      // Name (or input for rename mode)
      const nameSpan = document.createElement('span');
      nameSpan.className = 'tree-node-name';
      nameSpan.textContent = node.name;
      nodeEl.appendChild(nameSpan);

      // Rename input (replaces name inline)
      if (inputMode === 'rename' && inputNode === node) {
        nameSpan.style.display = 'none';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = node.name;
        input.placeholder = 'Rename';

        const handleRename = async (value: string) => {
          if (!value.trim()) {
            inputMode = null;
            inputNode = null;
            render();
            return;
          }
          try {
            status.textContent = 'Renaming...';
            status.style.color = '#888';
            await renameNode(state.host, state.token, state.owner, state.repo, node.dirPath, value.trim(), state.contentPaths);
            inputMode = null;
            inputNode = null;
            const newPaths = await refreshTree();
            state.contentPaths = newPaths;
            const expanded = getExpandedPaths(treeRoot);
            treeRoot = buildTreeNodes(newPaths, expanded);
            selectedIndex = Math.min(selectedIndex, getVisibleNodes(treeRoot).length - 1);
            status.textContent = '';
            render();
          } catch (err) {
            status.textContent = errorMessage(err);
            status.style.color = '#f87171';
          }
        };

        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') handleRename(input.value);
          else if (e.key === 'Escape') { inputMode = null; inputNode = null; render(); }
        });

        nodeEl.appendChild(input);
        pendingFocusInput = input;
      }

      nodeEl.addEventListener('click', () => {
        selectedIndex = visible.indexOf(node);
        render();
      });

      nodeEl.addEventListener('dblclick', () => {
        if (node.dirPath !== '') {
          location.hash = `#/${node.dirPath}`;
          overlay.remove();
        }
      });

      listContainer.appendChild(nodeEl);

      // For 'new' mode: insert a child input row immediately after the parent node
      if (inputMode === 'new' && inputNode === node) {
        const childDepth = node.depth + 1;
        const inputRow = document.createElement('div');
        inputRow.className = 'tree-input-row';
        inputRow.style.marginLeft = `${childDepth * 16}px`;

        const iconSpan = document.createElement('span');
        iconSpan.className = 'tree-expand-icon';
        iconSpan.textContent = '·';
        inputRow.appendChild(iconSpan);

        const input = document.createElement('input');
        input.type = 'text';
        input.value = '';
        input.placeholder = 'New name';

        const handleCreate = async (value: string) => {
          if (!value.trim()) {
            inputMode = null;
            inputNode = null;
            render();
            return;
          }
          try {
            const parentDirPath = node.dirPath;
            status.textContent = 'Creating...';
            status.style.color = '#888';
            await createNode(state.host, state.token, state.owner, state.repo, parentDirPath, value.trim(), state.contentPaths);
            inputMode = null;
            inputNode = null;
            const newPaths = await refreshTree();
            state.contentPaths = newPaths;
            const expanded = getExpandedPaths(treeRoot);
            expanded.add(parentDirPath);
            treeRoot = buildTreeNodes(newPaths, expanded);
            selectedIndex = Math.min(selectedIndex, getVisibleNodes(treeRoot).length - 1);
            status.textContent = '';
            render();
          } catch (err) {
            status.textContent = errorMessage(err);
            status.style.color = '#f87171';
          }
        };

        input.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') handleCreate(input.value);
          else if (e.key === 'Escape') { inputMode = null; inputNode = null; render(); }
        });

        inputRow.appendChild(input);
        listContainer.appendChild(inputRow);
        pendingFocusInput = input;
      }
    }

    // Focus the input after all elements are in the DOM
    if (pendingFocusInput) {
      pendingFocusInput.focus();
      pendingFocusInput.select();
      pendingFocusInput = null;
    }

    // Scroll selected node into view
    const selectedEl = listContainer.querySelector('.tree-node-selected');
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  // Keyboard handler
  function handleKeydown(e: KeyboardEvent) {
    const visible = getVisibleNodes(treeRoot);
    const selectedNode = visible[selectedIndex];

    // If in input mode, only handle Escape (fallback if input didn't get focus)
    if (inputMode) {
      if (e.key === 'Escape') {
        e.preventDefault();
        inputMode = null;
        inputNode = null;
        render();
      }
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'k') {
      e.preventDefault();
      selectedIndex = Math.max(0, selectedIndex - 1);
      lastKey = '';
      render();
    } else if (e.key === 'ArrowDown' || e.key === 'j') {
      e.preventDefault();
      selectedIndex = Math.min(visible.length - 1, selectedIndex + 1);
      lastKey = '';
      render();
    } else if (e.key === 'ArrowRight' || e.key === 'l') {
      e.preventDefault();
      if (selectedNode && selectedNode.children.length > 0) {
        selectedNode.expanded = true;
        render();
      }
      lastKey = '';
    } else if (e.key === 'ArrowLeft' || e.key === 'h') {
      e.preventDefault();
      if (selectedNode) {
        if (selectedNode.expanded) {
          selectedNode.expanded = false;
          render();
        } else if (selectedNode.depth > 0) {
          // Jump to parent
          const parentPath = selectedNode.dirPath.slice(0, selectedNode.dirPath.lastIndexOf('/'));
          const parentNode = visible.find(n => n.dirPath === parentPath);
          if (parentNode) {
            selectedIndex = visible.indexOf(parentNode);
            render();
          }
        }
      }
      lastKey = '';
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedNode && selectedNode.dirPath !== '') {
        location.hash = `#/${selectedNode.dirPath}`;
        overlay.remove();
      }
      lastKey = '';
    } else if (e.key === 'Insert' || e.key === 'i') {
      e.preventDefault();
      if (selectedNode && !pendingDelete) {
        // Auto-expand the selected node so user can see the new child input row
        selectedNode.expanded = true;
        inputMode = 'new';
        inputNode = selectedNode;
        render();
      }
      lastKey = '';
    } else if (e.key === 'Delete' || (e.key === 'd' && lastKey === 'd')) {
      e.preventDefault();
      if (selectedNode && selectedNode.dirPath !== '' && !inputMode) {
        handleDelete(selectedNode);
      }
      lastKey = '';
    } else if (e.key === 'd') {
      e.preventDefault();
      lastKey = 'd';
    } else if (e.key === 'F2') {
      e.preventDefault();
      if (selectedNode && selectedNode.dirPath !== '' && !pendingDelete && !inputMode) {
        inputMode = 'rename';
        inputNode = selectedNode;
        render();
      }
      lastKey = '';
    } else if (e.key === 'm') {
      e.preventDefault();
      if (selectedNode && selectedNode.dirPath !== '' && !inputMode && !pendingDelete) {
        if (moveSource && moveSource.dirPath === selectedNode.dirPath) {
          moveSource = null;
          status.textContent = '';
        } else {
          moveSource = selectedNode;
          status.textContent = `Marked '${selectedNode.name}' for move — navigate to destination and press p`;
          status.style.color = '#fbbf24';
        }
        render();
      }
      lastKey = '';
    } else if (e.key === 'p') {
      e.preventDefault();
      if (moveSource && selectedNode && !inputMode && !pendingDelete) {
        handleMove(moveSource, selectedNode);
      }
      lastKey = '';
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (inputMode) {
        inputMode = null;
        inputNode = null;
        render();
      } else if (moveSource) {
        moveSource = null;
        status.textContent = '';
        render();
      } else if (pendingDelete) {
        pendingDelete = null;
        renderConfirmation();
      } else {
        overlay.remove();
      }
      lastKey = '';
    } else if (e.key === 'Home') {
      e.preventDefault();
      selectedIndex = 0;
      lastKey = '';
      render();
    } else if (e.key === 'End') {
      e.preventDefault();
      selectedIndex = visible.length - 1;
      lastKey = '';
      render();
    } else if (e.key === 'g') {
      e.preventDefault();
      if (lastKey === 'g') {
        selectedIndex = 0;
        lastKey = '';
        render();
      } else {
        lastKey = 'g';
      }
    } else if (e.key === 'u') {
      e.preventDefault();
      overlay.remove();
      lastKey = '';
    } else {
      lastKey = '';
    }
  }

  async function handleDelete(node: TreeNode) {
    try {
      status.textContent = 'Checking...';
      status.style.color = '#888';

      const result = await deleteNode(state.host, state.token, state.owner, state.repo, node.dirPath, state.contentPaths);

      if (result.needsConfirm) {
        pendingDelete = { paths: result.paths };
        renderConfirmation();
      } else {
        // Deleted single file, refresh
        const newPaths = await refreshTree();
        state.contentPaths = newPaths;
        const expanded = getExpandedPaths(treeRoot);
        treeRoot = buildTreeNodes(newPaths, expanded);
        selectedIndex = Math.min(selectedIndex, getVisibleNodes(treeRoot).length - 1);
        status.textContent = '';
        render();
        logInfo(`TreePanel: Deleted ${node.dirPath}`);
      }
    } catch (err) {
      status.textContent = errorMessage(err);
      status.style.color = '#f87171';
    }
  }

  async function handleMove(source: TreeNode, dest: TreeNode) {
    try {
      status.textContent = 'Moving...';
      status.style.color = '#888';
      const newDirPath = await moveNode(
        state.host, state.token, state.owner, state.repo,
        source.dirPath, dest.dirPath, state.contentPaths,
      );
      moveSource = null;
      const newPaths = await refreshTree();
      state.contentPaths = newPaths;
      const expanded = getExpandedPaths(treeRoot);
      expanded.add(dest.dirPath);
      treeRoot = buildTreeNodes(newPaths, expanded);
      expandToPath(treeRoot, newDirPath);
      const visibleAfter = getVisibleNodes(treeRoot);
      const movedIdx = visibleAfter.findIndex(n => n.dirPath === newDirPath);
      selectedIndex = movedIdx >= 0 ? movedIdx : Math.min(selectedIndex, visibleAfter.length - 1);
      status.textContent = '';
      render();
      logInfo(`TreePanel: Moved ${source.dirPath} → ${newDirPath}`);
    } catch (err) {
      status.textContent = errorMessage(err);
      status.style.color = '#f87171';
    }
  }

  function renderConfirmation() {
    if (!pendingDelete) {
      footer.innerHTML = '';
      const closeBtn = document.createElement('button');
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', () => overlay.remove());
      footer.appendChild(closeBtn);
      return;
    }

    footer.innerHTML = '';
    status.textContent = `Delete ${pendingDelete.paths.length} node(s)?`;
    status.style.color = '#fbbf24';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      pendingDelete = null;
      renderConfirmation();
      render();
    });
    footer.appendChild(cancelBtn);

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = `Confirm Delete ${pendingDelete.paths.length}`;
    confirmBtn.className = 'tree-delete-btn';
    confirmBtn.addEventListener('click', async () => {
      try {
        status.textContent = 'Deleting...';
        status.style.color = '#888';
        await confirmDeleteNodes(state.host, state.token, state.owner, state.repo, pendingDelete!.paths);
        const newPaths = await refreshTree();
        state.contentPaths = newPaths;
        const expanded = getExpandedPaths(treeRoot);
        treeRoot = buildTreeNodes(newPaths, expanded);
        selectedIndex = Math.min(selectedIndex, getVisibleNodes(treeRoot).length - 1);
        pendingDelete = null;
        status.textContent = '';
        renderConfirmation();
        render();
      } catch (err) {
        status.textContent = errorMessage(err);
        status.style.color = '#f87171';
      }
    });
    footer.appendChild(confirmBtn);
  }

  // Wire events
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  pushModal(overlay);

  const keyListener = (e: KeyboardEvent) => {
    if (overlay.parentElement) {
      handleKeydown(e);
    }
  };
  document.addEventListener('keydown', keyListener);

  // Clean up listener and modal stack when overlay is removed
  const originalRemove = overlay.remove.bind(overlay);
  overlay.remove = function() {
    popModal(overlay);
    document.removeEventListener('keydown', keyListener);
    originalRemove();
  };

  // Initial render
  render();
  renderConfirmation();
  document.body.appendChild(overlay);

  // Scroll selected node into view now that the panel is in the DOM
  const initialSelected = listContainer.querySelector('.tree-node-selected');
  if (initialSelected) {
    initialSelected.scrollIntoView({ block: 'center' });
  }
}
