/** Type declarations for veditor.web runtime import (0.45 and later; the file editor checks VERSION). */

export const VERSION: string;

export interface DocEntry {
  id: string;
  label: string;
}

export interface VEditorCallbacks {
  /** Resolve false when nothing was saved (cancelled or failed): the buffer stays dirty. */
  onSave: () => Promise<void | boolean>;
  onQuit: () => void;
  isAppDirty?: () => boolean;
  onListDocuments?: () => Promise<DocEntry[]>;
  onLoadDocument?: (id: string) => Promise<{ content: string; label: string; callbacks: VEditorCallbacks }>;
  onBufferSwitch?: (id: string, label: string) => void;
  /** veditor >= 0.45: fires on every document change in the buffer. Read the text with getEditorContent(). */
  onChange?: () => void;
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
/** markSaved: false (veditor >= 0.45) makes the replacement an edit: the buffer goes dirty. */
export function setEditorContent(content: string, opts?: { bufferId?: string; markSaved?: boolean }): void;
export function isEditorDirty(original: string): boolean;
export function focusEditor(): void;
export function destroyEditor(): void;
export function exitInsertMode(): void;
export function executeExCommand(cmd: string): void;
export function toggleVimMode(): boolean;
export function isVimMode(): boolean;
/** Resolves whether the save happened. */
export function requestSave(): Promise<boolean>;
export function requestQuit(force?: boolean): void;
export function hashTarget(url: string): string;
export function getAutoSaveMs(): number;
