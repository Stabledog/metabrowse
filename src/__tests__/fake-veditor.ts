/**
 * A stand-in for veditor.web with the 0.45 contract the file editor relies on:
 * onSave resolving false keeps the buffer dirty, the text is snapshotted before
 * the save, onChange fires on edits, and a dirty quit needs Discard or force.
 */

import type { VEditorCallbacks } from '../veditor.d.ts';

export let VERSION = '0.45.0';

let callbacks: VEditorCallbacks | null = null;
let content = '';
let saved = '';
/** Set when a dirty :q would show veditor's confirm bar. */
export let quitBlocked = false;

export function reset(version = '0.45.0'): void {
  VERSION = version;
  callbacks = null;
  content = saved = '';
  quitBlocked = false;
}

export function isOpen(): boolean {
  return callbacks !== null;
}

export function createEditor(_parent: HTMLElement, text: string, cbs: VEditorCallbacks): unknown {
  callbacks = cbs;
  content = saved = text;
  return {};
}

export function getEditorContent(): string {
  return content;
}

export function setEditorContent(text: string, opts?: { markSaved?: boolean }): void {
  content = text;
  if (opts?.markSaved !== false) saved = text;
  callbacks?.onChange?.(); // veditor fires it for every document change
}

/** Simulates typing at the end of the buffer. */
export function type(text: string): void {
  content += text;
  callbacks?.onChange?.();
}

export function isDirty(): boolean {
  return content !== saved;
}

export async function requestSave(): Promise<boolean> {
  const snapshot = content;
  if ((await callbacks!.onSave()) === false) return false;
  saved = snapshot;
  return true;
}

export function requestQuit(force = false): void {
  if (!callbacks) return;
  if (!force && isDirty()) {
    quitBlocked = true;
    return;
  }
  callbacks.onQuit();
}

/** The confirm bar's Discard. */
export function discardAndQuit(): void {
  quitBlocked = false;
  callbacks!.onQuit();
}

export function destroyEditor(): void {
  callbacks = null;
}

export function focusEditor(): void {}
