import './style.css';
import { init } from './app.ts';
import { initFileEditor } from './file-editor.ts';
import { isBlobHash } from './blob-route.ts';

if (isBlobHash(location.hash)) {
  initFileEditor(document.getElementById('app')!);
} else {
  init();
}
