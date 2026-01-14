/**
 * media.js - 이미지/비디오 처리
 */

import { elements, mediaState } from './state.js';
import { triggerSave } from './memo.js';

const { editor } = elements;

// ===== 이미지 붙여넣기 =====

export async function handleImagePaste(file) {
  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1];
      const result = await window.api.saveImage(base64, file.type);

      if (result.success) {
        insertImageAtCursor(result.path);
      }
    };
    reader.readAsDataURL(file);
  } catch (e) {
    console.error('Image paste error:', e);
  }
}

function insertImageAtCursor(imagePath) {
  const img = document.createElement('img');
  img.src = `file://${imagePath}`;
  img.className = 'memo-image';
  img.setAttribute('data-path', imagePath);

  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(img);

    range.setStartAfter(img);
    range.setEndAfter(img);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    editor.appendChild(img);
  }

  triggerSave();
}

// ===== 비디오 붙여넣기 =====

export async function handleVideoPaste(file) {
  try {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1];
      const result = await window.api.saveVideo(base64, file.type);

      if (result.success) {
        insertVideoAtCursor(result.path, file.type);
      } else {
        console.error('Video save failed:', result.error);
      }
    };
    reader.readAsDataURL(file);
  } catch (e) {
    console.error('Video paste error:', e);
  }
}

function insertVideoAtCursor(videoPath, mimeType) {
  const video = document.createElement('video');
  video.src = `file://${videoPath}`;
  video.className = 'memo-video';
  video.setAttribute('data-path', videoPath);
  video.setAttribute('controls', 'true');
  video.setAttribute('preload', 'metadata');
  video.setAttribute('contenteditable', 'false');

  if (mimeType) {
    const source = document.createElement('source');
    source.src = `file://${videoPath}`;
    source.type = mimeType;
    video.appendChild(source);
  }

  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(video);

    range.setStartAfter(video);
    range.setEndAfter(video);
    selection.removeAllRanges();
    selection.addRange(range);
  } else {
    editor.appendChild(video);
  }

  triggerSave();
}

// ===== 미디어 선택/삭제 =====

export function selectMedia(element) {
  if (mediaState.selectedMedia) {
    mediaState.selectedMedia.classList.remove('selected');
  }
  mediaState.selectedMedia = element;
  if (element) {
    element.classList.add('selected');
    element.focus();
  }
}

export function deleteSelectedMedia() {
  if (mediaState.selectedMedia) {
    mediaState.selectedMedia.remove();
    mediaState.selectedMedia = null;
    triggerSave();
  }
}

// ===== 미디어 이벤트 초기화 =====

export function initMediaEvents() {
  // 미디어 클릭 시 선택
  editor.addEventListener('click', (e) => {
    const media = e.target.closest('.memo-image, .memo-video');
    if (media) {
      e.preventDefault();
      selectMedia(media);
    } else {
      selectMedia(null);
    }
  });

  // 키보드로 미디어 삭제
  editor.addEventListener('keydown', (e) => {
    if (mediaState.selectedMedia && (e.key === 'Backspace' || e.key === 'Delete')) {
      e.preventDefault();
      deleteSelectedMedia();
    }
  });
}
