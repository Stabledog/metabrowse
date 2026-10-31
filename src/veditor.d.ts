/** Type declarations for veditor.web runtime import. */

export const VERSION: string;

export interface DocEntry {
  id: string;
  label: string;
}

export interface VEditorCallbacks {
  /** Resolve false when nothing was saved (cancelled or failed): the buffer stays dirty. veditor < 0.45 ignores the value. */
  onSave: () => Promise<void | boolean>;
  onQuit: () => void;
  isAppDirty?: () => boolean;
  onListDocuments?: () => Promise<DocEntry[]>;
  onLoadDocument?: (id: string) => Promise<{ content: string; label: string; callbacks: VEditorCallbacks }>;
  onBufferSwitch?: (id: string, label: string) => void;
}

export interface VEditorOptions {
  storagePrefix?: string;
  clickableLinks?: boolean;
  exCommands?: Record<string, (...args: unknown[]) => void>;
  normalMappings?: Record<string, () => void>;
  extensions?: unknown[];
  autoSaveMs?: number;
  initialBufferId?: string;
  initialBufferLabel?: string;
}

export function createEditor(
  parent: HTMLElement,
  content: string,
  callbacks: VEditorCallbacks,
  options?: VEditorOptions,
): unknown;

export function getEditorContent(): string;
export function isEditorDirty(original: string): boolean;
export function focusEditor(): void;
export function destroyEditor(): void;
export function exitInsertMode(): void;
export function executeExCommand(cmd: string): void;
export function toggleVimMode(): boolean;
export function isVimMode(): boolean;
/** Resolves whether the save happened (veditor >= 0.45; older versions resolve undefined). */
export function requestSave(): Promise<boolean | void>;
export function requestQuit(force?: boolean): void;
export function hashTarget(url: string): string;
export function getAutoSaveMs(): number;
