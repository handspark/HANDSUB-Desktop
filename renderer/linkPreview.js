/**
 * linkPreview.js - 링크 감지 및 미리보기
 */

import { elements, sidebarState, linkState, timers } from './state.js';

const { editor, sidebar, linkPreviewsContainer } = elements;

// URL 정규식 (최소 도메인.확장자 형태)
const urlRegex = /(https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}[^\s<]*)/g;

// 에디터 내용에서 plain text 가져오기 (순환 참조 방지를 위해 여기서 직접 구현)
function getPlainTextLocal() {
  return editor.innerText || editor.textContent || '';
}

// ===== 링크 프리뷰 처리 =====

export function clearLinkPreviews() {
  linkPreviewsContainer.innerHTML = '';
}

export function updateEditorForPreviews() {
  if (sidebar.classList.contains('open')) {
    linkPreviewsContainer.style.left = (sidebarState.sidebarWidth + 20) + 'px';
  } else {
    linkPreviewsContainer.style.left = '20px';
  }
}

export function processLinksInEditor() {
  clearTimeout(timers.linkProcessTimeout);
  timers.linkProcessTimeout = setTimeout(async () => {
    const text = getPlainTextLocal();
    const urls = text.match(urlRegex) || [];

    // 중복 제거
    const uniqueUrls = [...new Set(urls)];

    // 현재 표시된 프리뷰와 비교
    const currentPreviews = new Set(
      Array.from(linkPreviewsContainer.querySelectorAll('.link-preview'))
        .map(el => el.getAttribute('data-link-url'))
    );

    // 삭제된 링크의 프리뷰 제거
    for (const url of currentPreviews) {
      if (!uniqueUrls.includes(url)) {
        const preview = linkPreviewsContainer.querySelector(`[data-link-url="${url}"]`);
        if (preview) preview.remove();
      }
    }

    // 새 링크 처리
    for (const url of uniqueUrls) {
      if (!currentPreviews.has(url)) {
        await createLinkPreview(url);
      }
    }

    updateEditorForPreviews();
  }, 1000);
}

async function createLinkPreview(url) {
  try {
    // 이미 프리뷰가 있으면 스킵
    if (linkPreviewsContainer.querySelector(`[data-link-url="${url}"]`)) {
      return;
    }

    // 캐시 확인
    let data = linkState.cache.get(url);

    if (!data) {
      let result;
      try {
        result = await window.api.fetchLinkMeta(url);
      } catch (fetchErr) {
        return;
      }

      if (!result || !result.success || !result.data) {
        return;
      }

      data = result.data;
      linkState.cache.set(url, data);
    }

    const { title, description, image, favicon } = data;
    if (!title && !description && !image && !favicon) {
      return;
    }

    const previewEl = createPreviewElement(url, title, description, image, favicon);
    linkPreviewsContainer.appendChild(previewEl);

    updateEditorForPreviews();
  } catch (e) {
    console.error('Link preview error:', e);
  }
}

function createPreviewElement(url, title, description, image, favicon) {
  const hostname = new URL(url).hostname;
  const displayTitle = title || hostname;

  const link = document.createElement('a');
  link.className = 'link-preview';
  link.href = url;
  link.setAttribute('data-link-url', url);

  if (image) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'link-preview-image';
    const img = document.createElement('img');
    img.src = image;
    img.alt = '';
    img.loading = 'lazy';
    img.addEventListener('error', () => { imgWrap.style.display = 'none'; });
    imgWrap.appendChild(img);
    link.appendChild(imgWrap);
  }

  const content = document.createElement('div');
  content.className = 'link-preview-content';

  if (favicon) {
    const fav = document.createElement('img');
    fav.className = 'link-preview-favicon';
    fav.src = favicon;
    fav.alt = '';
    fav.addEventListener('error', () => { fav.style.display = 'none'; });
    content.appendChild(fav);
  }

  const titleDiv = document.createElement('div');
  titleDiv.className = 'link-preview-title';
  titleDiv.textContent = displayTitle;
  content.appendChild(titleDiv);

  if (description) {
    const descDiv = document.createElement('div');
    descDiv.className = 'link-preview-desc';
    descDiv.textContent = description.length > 100 ? description.substring(0, 100) + '...' : description;
    content.appendChild(descDiv);
  }

  link.appendChild(content);

  link.addEventListener('click', (e) => {
    e.preventDefault();
    window.api.openExternal(url);
  });

  return link;
}
