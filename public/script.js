// DOM 元素
const articleUrlInput = document.getElementById('article-url');
const convertBtn = document.getElementById('convert-btn');
const statusSection = document.getElementById('status-section');
const statusText = document.getElementById('status-text');
const statusEta = document.getElementById('status-eta');
const progressFill = document.getElementById('progress-fill');
const errorSection = document.getElementById('error-section');
const errorText = document.getElementById('error-text');
const retryBtn = document.getElementById('retry-btn');
const podcastList = document.getElementById('podcast-list');
const playerSection = document.getElementById('player-section');
const playerTitle = document.getElementById('player-title');
const playerAccount = document.getElementById('player-account');
const playBtn = document.getElementById('play-btn');
const progressSlider = document.getElementById('progress-slider');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const speedSelect = document.getElementById('speed-select');
const downloadBtn = document.getElementById('download-btn');
const audioPlayer = document.getElementById('audio-player');

// 状态
let currentTaskId = null;
let pollInterval = null;
let currentPodcastId = null;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  loadPodcasts();
  setupEventListeners();
});

// 事件监听
function setupEventListeners() {
  convertBtn.addEventListener('click', handleConvert);
  retryBtn.addEventListener('click', handleRetry);

  // 回车提交
  articleUrlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleConvert();
  });

  // 播放器控制
  playBtn.addEventListener('click', togglePlay);
  progressSlider.addEventListener('input', handleSeek);
  speedSelect.addEventListener('change', handleSpeedChange);
  downloadBtn.addEventListener('click', handleDownload);

  // 音频事件
  audioPlayer.addEventListener('timeupdate', updateProgress);
  audioPlayer.addEventListener('loadedmetadata', updateDuration);
  audioPlayer.addEventListener('ended', handleEnded);
}

// 提交转换
async function handleConvert() {
  const url = articleUrlInput.value.trim();

  if (!url) {
    showError('请输入文章链接');
    return;
  }

  if (!url.includes('mp.weixin.qq.com')) {
    showError('请输入有效的微信公众号文章链接');
    return;
  }

  try {
    convertBtn.disabled = true;
    hideError();
    showStatus('正在提交...', '');

    const response = await fetch('/api/article', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '提交失败');
    }

    currentTaskId = data.taskId;
    articleUrlInput.value = '';
    startPolling();

  } catch (error) {
    showError(error.message);
    hideStatus();
    convertBtn.disabled = false;
  }
}

// 重试
function handleRetry() {
  hideError();
  articleUrlInput.focus();
}

// 开始轮询状态
function startPolling() {
  if (pollInterval) clearInterval(pollInterval);

  pollInterval = setInterval(async () => {
    try {
      const response = await fetch(`/api/status/${currentTaskId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '查询状态失败');
      }

      updateStatusDisplay(data);

      if (data.status === 'completed') {
        stopPolling();
        hideStatus();
        convertBtn.disabled = false;
        loadPodcasts();
      } else if (data.status === 'failed') {
        stopPolling();
        hideStatus();
        showError(data.error || '处理失败');
        convertBtn.disabled = false;
      }

    } catch (error) {
      console.error('轮询错误:', error);
    }
  }, 1000);
}

// 停止轮询
function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// 更新状态显示
function updateStatusDisplay(data) {
  showStatus(data.statusText, data.etaText ? `预计还需 ${data.etaText}` : '');

  // 更新进度条
  const progressMap = {
    'pending': 0,
    'parsing': 20,
    'generating': 50,
    'synthesizing': 80,
    'completed': 100
  };
  progressFill.style.width = (progressMap[data.status] || 0) + '%';
}

// 显示/隐藏状态
function showStatus(text, eta) {
  statusSection.style.display = 'block';
  statusText.textContent = text;
  statusEta.textContent = eta;
}

function hideStatus() {
  statusSection.style.display = 'none';
}

// 显示/隐藏错误
function showError(message) {
  errorSection.style.display = 'block';
  errorText.textContent = message;
}

function hideError() {
  errorSection.style.display = 'none';
}

// 加载播客列表
async function loadPodcasts() {
  try {
    const response = await fetch('/api/podcasts');
    const data = await response.json();
    const podcasts = data.podcasts || data; // 兼容两种格式

    if (!podcasts || podcasts.length === 0) {
      podcastList.innerHTML = '<p class="empty-hint">暂无播客，输入文章链接开始转换</p>';
      return;
    }

    podcastList.innerHTML = podcasts.map(podcast => `
      <div class="podcast-item ${currentPodcastId === podcast.id ? 'playing' : ''}" data-id="${podcast.id}">
        <div class="podcast-play-icon" onclick="playPodcast('${podcast.id}')">▶</div>
        <div class="podcast-info" onclick="playPodcast('${podcast.id}')">
          <p class="podcast-title">${escapeHtml(podcast.sourceFileName || podcast.title)}</p>
          <p class="podcast-meta">
            ${podcast.accountName ? escapeHtml(podcast.accountName) + ' · ' : ''}
            ${formatDuration(podcast.durationMs)} ·
            ${formatFileSize(podcast.fileSizeBytes)} ·
            ${formatTime(podcast.generatedAt)}
          </p>
          ${(podcast.summary || podcast.scriptPreview) ? `<p class="podcast-preview">${escapeHtml(podcast.summary || podcast.scriptPreview)}</p>` : '<p class="podcast-preview empty">暂无简介</p>'}
        </div>
        <div class="podcast-actions">
          <button onclick="event.stopPropagation(); downloadPodcast('${podcast.id}', '${escapeHtml(podcast.sourceFileName || 'podcast')}')">下载</button>
          <button class="delete-btn" onclick="event.stopPropagation(); deletePodcast('${podcast.id}')">删除</button>
        </div>
      </div>
    `).join('');

  } catch (error) {
    console.error('加载播客列表失败:', error);
  }
}

// 播放播客
async function playPodcast(id) {
  try {
    const response = await fetch(`/api/podcasts/${id}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '获取播客信息失败');
    }

    const podcast = data.podcast || data; // 兼容两种格式

    currentPodcastId = id;
    playerTitle.textContent = podcast.sourceFileName || podcast.title;
    playerAccount.textContent = podcast.accountName || '';
    audioPlayer.src = `/audio/${id}.mp3`;
    audioPlayer.play();
    playBtn.textContent = '⏸';
    playerSection.style.display = 'block';

    // 更新列表高亮
    document.querySelectorAll('.podcast-item').forEach(item => {
      item.classList.toggle('playing', item.dataset.id === id);
    });

  } catch (error) {
    console.error('播放失败:', error);
    alert('播放失败: ' + error.message);
  }
}

// 播放/暂停
function togglePlay() {
  if (audioPlayer.paused) {
    audioPlayer.play();
    playBtn.textContent = '⏸';
  } else {
    audioPlayer.pause();
    playBtn.textContent = '▶';
  }
}

// 进度控制
function handleSeek() {
  const time = (progressSlider.value / 100) * audioPlayer.duration;
  audioPlayer.currentTime = time;
}

function updateProgress() {
  if (audioPlayer.duration) {
    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    progressSlider.value = progress;
    currentTimeEl.textContent = formatDuration(audioPlayer.currentTime * 1000);
  }
}

function updateDuration() {
  totalTimeEl.textContent = formatDuration(audioPlayer.duration * 1000);
}

// 播放结束
function handleEnded() {
  playBtn.textContent = '▶';
}

// 倍速控制
function handleSpeedChange() {
  audioPlayer.playbackRate = parseFloat(speedSelect.value);
}

// 下载当前播放
function handleDownload() {
  if (currentPodcastId) {
    downloadPodcast(currentPodcastId, playerTitle.textContent);
  }
}

// 下载播客
function downloadPodcast(id, filename) {
  const link = document.createElement('a');
  link.href = `/audio/${id}.mp3`;
  link.download = `${filename}.mp3`;
  link.click();
}

// 删除播客
async function deletePodcast(id) {
  if (!confirm('确定要删除这个播客吗？')) return;

  try {
    const response = await fetch(`/api/podcasts/${id}`, { method: 'DELETE' });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || '删除失败');
    }

    // 如果正在播放这个播客，停止播放
    if (currentPodcastId === id) {
      audioPlayer.pause();
      playerSection.style.display = 'none';
      currentPodcastId = null;
    }

    loadPodcasts();

  } catch (error) {
    console.error('删除失败:', error);
    alert('删除失败: ' + error.message);
  }
}

// 工具函数
function formatDuration(ms) {
  if (!ms) return '0:00';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function formatFileSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
  if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';

  return date.toLocaleDateString('zh-CN');
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
