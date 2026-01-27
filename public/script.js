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
const podcastCount = document.getElementById('podcast-count');
const playerSection = document.getElementById('player-section');
const playerTitle = document.getElementById('player-title');
const playerAccount = document.getElementById('player-account');
const playBtn = document.getElementById('play-btn');
const mobilePlayBtn = document.getElementById('mobile-play-btn');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const progressSlider = document.getElementById('progress-slider');
const currentTimeEl = document.getElementById('current-time');
const totalTimeEl = document.getElementById('total-time');
const speedSelect = document.getElementById('speed-select');
const downloadBtn = document.getElementById('download-btn');
const audioPlayer = document.getElementById('audio-player');
const playerVisualizer = document.querySelector('.player-visualizer');

// 详情页 DOM 元素
const detailOverlay = document.getElementById('detail-overlay');
const detailDrawer = document.getElementById('detail-drawer');
const detailCloseBtn = document.getElementById('detail-close-btn');
const detailShareBtn = document.getElementById('detail-share-btn');
const detailTitle = document.getElementById('detail-title');
const detailAccount = document.getElementById('detail-account');
const detailDescription = document.getElementById('detail-description');
const detailSourceBtn = document.getElementById('detail-source-btn');
const detailSpeedBtn = document.getElementById('detail-speed-btn');
const detailSpeedText = document.getElementById('detail-speed-text');
const detailSpeedMenu = document.getElementById('detail-speed-menu');
const detailCurrentTime = document.getElementById('detail-current-time');
const detailTotalTime = document.getElementById('detail-total-time');
const detailProgress = document.getElementById('detail-progress');
const detailPlayBtn = document.getElementById('detail-play-btn');
const detailBackwardBtn = document.getElementById('detail-backward-btn');
const detailForwardBtn = document.getElementById('detail-forward-btn');
const toastEl = document.getElementById('toast');

// 状态
let currentTaskId = null;
let pollInterval = null;
let currentPodcastId = null;
let podcastsList = []; // 保存播客列表用于上下曲切换
let currentPodcastData = null; // 当前播客完整数据
let isDetailOpen = false; // 详情页是否打开

// v2.0: 用户状态
let currentUser = null;
let currentQuota = null;
let isAuthMode = 'login'; // 'login' | 'register'

// v2.0: 带认证的 fetch 封装（使用 Cookie，credentials: 'include'）
async function authFetch(url, options = {}) {
  const defaultHeaders = { 'Content-Type': 'application/json' };
  return fetch(url, {
    ...options,
    credentials: 'include',
    headers: { ...defaultHeaders, ...options.headers }
  });
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await checkAuthStatus();
  loadPodcasts();
  setupEventListeners();
  handleShareLink();
});

// ==================== 用户认证 ====================

// 检查登录状态
async function checkAuthStatus() {
  try {
    const response = await authFetch('/api/auth/me');
    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
      currentQuota = data.quota;
      updateUserUI();
    } else {
      // 未登录
      currentUser = null;
      updateUserUI();
    }
  } catch (error) {
    console.error('检查登录状态失败:', error);
    currentUser = null;
    updateUserUI();
  }
}

// 更新用户界面
function updateUserUI() {
  const guestBar = document.getElementById('guest-bar');
  const userBar = document.getElementById('user-bar');
  const guestWarning = document.getElementById('guest-warning');

  if (currentUser) {
    // 已登录
    guestBar.style.display = 'none';
    userBar.style.display = 'flex';
    guestWarning.style.display = 'none';

    document.getElementById('user-phone').textContent = maskPhone(currentUser.phone);
    document.getElementById('user-tier').textContent = getTierName(currentUser.tier);

    if (currentQuota) {
      document.getElementById('user-quota').textContent =
        `今日配额: ${currentQuota.usage}/${currentQuota.limit}`;
    }
  } else {
    // 未登录（访客）
    guestBar.style.display = 'flex';
    userBar.style.display = 'none';
    guestWarning.style.display = 'flex';

    // 访客配额显示
    document.getElementById('guest-quota').textContent = '今日配额: 1 次';
  }
}

// 手机号脱敏
function maskPhone(phone) {
  if (!phone || phone.length !== 11) return phone;
  return phone.substring(0, 3) + '****' + phone.substring(7);
}

// 获取等级名称
function getTierName(tier) {
  const names = { guest: '访客', free: '免费用户', paid: '付费用户' };
  return names[tier] || tier;
}

// 打开认证弹窗
function openAuthModal(mode = 'login') {
  isAuthMode = mode;
  updateAuthModalUI();

  const overlay = document.getElementById('auth-overlay');
  overlay.style.display = 'flex';

  // 清空输入
  document.getElementById('auth-phone').value = '';
  document.getElementById('auth-password').value = '';
  document.getElementById('auth-error').style.display = 'none';
}

// 关闭认证弹窗
function closeAuthModal() {
  document.getElementById('auth-overlay').style.display = 'none';
}

// 切换登录/注册模式
function toggleAuthMode() {
  isAuthMode = isAuthMode === 'login' ? 'register' : 'login';
  updateAuthModalUI();
}

// 更新认证弹窗 UI
function updateAuthModalUI() {
  const title = document.getElementById('auth-title');
  const submitBtn = document.getElementById('auth-submit-btn');
  const switchText = document.getElementById('auth-switch-text');
  const switchLink = document.getElementById('auth-switch-link');

  if (isAuthMode === 'login') {
    title.textContent = '登录';
    submitBtn.textContent = '登录';
    switchText.textContent = '还没有账号？';
    switchLink.textContent = '去注册';
  } else {
    title.textContent = '注册';
    submitBtn.textContent = '注册';
    switchText.textContent = '已有账号？';
    switchLink.textContent = '去登录';
  }
}

// 提交认证
async function handleAuthSubmit(event) {
  event.preventDefault();

  const phone = document.getElementById('auth-phone').value.trim();
  const password = document.getElementById('auth-password').value;
  const errorEl = document.getElementById('auth-error');
  const submitBtn = document.getElementById('auth-submit-btn');

  // 验证
  if (!/^1[3-9]\d{9}$/.test(phone)) {
    errorEl.textContent = '请输入有效的手机号';
    errorEl.style.display = 'block';
    return;
  }

  if (password.length < 6) {
    errorEl.textContent = '密码至少 6 位';
    errorEl.style.display = 'block';
    return;
  }

  try {
    submitBtn.disabled = true;
    submitBtn.textContent = isAuthMode === 'login' ? '登录中...' : '注册中...';

    const endpoint = isAuthMode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const response = await authFetch(endpoint, {
      method: 'POST',
      body: JSON.stringify({ phone, password })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '操作失败');
    }

    // 成功
    currentUser = data.user;
    closeAuthModal();
    await checkAuthStatus(); // 刷新配额信息
    loadPodcasts(); // 刷新播客列表
    showToast(isAuthMode === 'login' ? '登录成功' : '注册成功');

  } catch (error) {
    errorEl.textContent = error.message;
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = isAuthMode === 'login' ? '登录' : '注册';
  }
}

// 登出
async function handleLogout() {
  try {
    await authFetch('/api/auth/logout', { method: 'POST' });
    currentUser = null;
    currentQuota = null;
    updateUserUI();
    loadPodcasts();
    showToast('已退出登录');
  } catch (error) {
    console.error('登出失败:', error);
  }
}

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
  mobilePlayBtn?.addEventListener('click', togglePlay);
  prevBtn?.addEventListener('click', playPrevious);
  nextBtn?.addEventListener('click', playNext);
  progressSlider.addEventListener('input', handleSeek);
  speedSelect.addEventListener('change', handleSpeedChange);
  downloadBtn.addEventListener('click', handleDownload);

  // 音频事件
  audioPlayer.addEventListener('timeupdate', updateProgress);
  audioPlayer.addEventListener('loadedmetadata', updateDuration);
  audioPlayer.addEventListener('ended', handleEnded);
  audioPlayer.addEventListener('play', () => {
    updatePlayButtonState(true);
    playerVisualizer?.classList.add('playing');
  });
  audioPlayer.addEventListener('pause', () => {
    updatePlayButtonState(false);
    playerVisualizer?.classList.remove('playing');
  });

  // 详情页事件
  detailCloseBtn?.addEventListener('click', closeDetail);
  detailOverlay?.addEventListener('click', closeDetail);
  detailShareBtn?.addEventListener('click', handleShare);
  detailSourceBtn?.addEventListener('click', handleViewSource);
  detailSpeedBtn?.addEventListener('click', toggleSpeedMenu);
  detailPlayBtn?.addEventListener('click', togglePlay);
  detailBackwardBtn?.addEventListener('click', () => seekRelative(-15));
  detailForwardBtn?.addEventListener('click', () => seekRelative(30));
  detailProgress?.addEventListener('input', handleDetailSeek);

  // 倍速菜单选项
  detailSpeedMenu?.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => handleDetailSpeedChange(parseFloat(btn.dataset.speed)));
  });

  // 点击播放器非控制区域打开详情页
  playerSection?.addEventListener('click', (e) => {
    if (shouldOpenDetailFromPlayer(e)) {
      openDetail();
    }
  });

  // 点击速度菜单外部关闭
  document.addEventListener('click', (e) => {
    if (detailSpeedMenu && !e.target.closest('.detail-speed-wrapper')) {
      detailSpeedMenu.style.display = 'none';
    }
  });

  // 手势支持：上滑打开详情页、下滑关闭
  let touchStartY = 0;
  let touchStartTime = 0;

  playerSection?.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  playerSection?.addEventListener('touchend', (e) => {
    const touchEndY = e.changedTouches[0].clientY;
    const deltaY = touchStartY - touchEndY;
    const deltaTime = Date.now() - touchStartTime;
    // 上滑超过 30px 且在 300ms 内
    if (deltaY > 30 && deltaTime < 300 && !isDetailOpen) {
      openDetail();
    }
  }, { passive: true });

  detailDrawer?.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  detailDrawer?.addEventListener('touchend', (e) => {
    const touchEndY = e.changedTouches[0].clientY;
    const deltaY = touchEndY - touchStartY;
    const deltaTime = Date.now() - touchStartTime;
    // 下滑超过 50px 且在 300ms 内
    if (deltaY > 50 && deltaTime < 300) {
      closeDetail();
    }
  }, { passive: true });
}

// 更新播放按钮状态
function updatePlayButtonState(isPlaying) {
  // 更新主播放按钮
  const playIcon = playBtn.querySelector('.play-icon');
  const pauseIcon = playBtn.querySelector('.pause-icon');
  if (playIcon && pauseIcon) {
    playIcon.style.display = isPlaying ? 'none' : 'block';
    pauseIcon.style.display = isPlaying ? 'block' : 'none';
  }
  // 更新移动端播放按钮
  if (mobilePlayBtn) {
    const mobilePlayIcon = mobilePlayBtn.querySelector('.play-icon');
    const mobilePauseIcon = mobilePlayBtn.querySelector('.pause-icon');
    if (mobilePlayIcon && mobilePauseIcon) {
      mobilePlayIcon.style.display = isPlaying ? 'none' : 'block';
      mobilePauseIcon.style.display = isPlaying ? 'block' : 'none';
    }
  }
  // 更新详情页播放按钮
  updateDetailPlayButtonState(isPlaying);
}

// 播放上一曲
function playPrevious() {
  if (!currentPodcastId || podcastsList.length === 0) return;
  const currentIndex = podcastsList.findIndex(p => p.id === currentPodcastId);
  if (currentIndex > 0) {
    playPodcast(podcastsList[currentIndex - 1].id);
  }
}

// 播放下一曲
function playNext() {
  if (!currentPodcastId || podcastsList.length === 0) return;
  const currentIndex = podcastsList.findIndex(p => p.id === currentPodcastId);
  if (currentIndex < podcastsList.length - 1) {
    playPodcast(podcastsList[currentIndex + 1].id);
  }
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
    updateConvertButtonState(true);
    hideError();
    showStatus('正在提交...', '');

    const response = await authFetch('/api/article', {
      method: 'POST',
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
    updateConvertButtonState(false);
  }
}

// 更新转换按钮状态
function updateConvertButtonState(isLoading) {
  const btnIcon = convertBtn.querySelector('.btn-icon');
  const btnText = convertBtn.querySelector('span');

  if (isLoading) {
    if (btnIcon) btnIcon.style.display = 'none';
    if (btnText) btnText.textContent = '生成中...';
    // 添加 spinner
    let spinner = convertBtn.querySelector('.btn-spinner');
    if (!spinner) {
      spinner = document.createElement('div');
      spinner.className = 'btn-spinner';
      convertBtn.insertBefore(spinner, btnText);
    }
  } else {
    if (btnIcon) btnIcon.style.display = 'block';
    if (btnText) btnText.textContent = '开始转换';
    const spinner = convertBtn.querySelector('.btn-spinner');
    if (spinner) spinner.remove();
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
      const response = await authFetch(`/api/status/${currentTaskId}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '查询状态失败');
      }

      updateStatusDisplay(data);

      if (data.status === 'completed') {
        stopPolling();
        hideStatus();
        convertBtn.disabled = false;
        updateConvertButtonState(false);
        loadPodcasts();
      } else if (data.status === 'failed') {
        stopPolling();
        hideStatus();
        showError(data.error || '处理失败');
        convertBtn.disabled = false;
        updateConvertButtonState(false);
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
    const response = await authFetch('/api/podcasts');
    const data = await response.json();
    const podcasts = data.podcasts || data; // 兼容两种格式
    podcastsList = podcasts || []; // 保存到全局变量用于上下曲切换

    // 更新播客数量
    if (podcastCount) {
      podcastCount.textContent = podcasts ? podcasts.length : 0;
    }

    if (!podcasts || podcasts.length === 0) {
      podcastList.innerHTML = `
        <div class="empty-hint">
          <p>暂无播客，快去转换第一篇文章吧！</p>
        </div>
      `;
      return;
    }

    podcastList.innerHTML = podcasts.map(podcast => `
      <div class="podcast-item ${currentPodcastId === podcast.id ? 'playing' : ''}" data-id="${podcast.id}">
        <div class="podcast-content">
          <button class="podcast-play-btn" onclick="playPodcast('${podcast.id}')">
            <svg class="play-icon" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="6 3 20 12 6 21 6 3"></polygon>
            </svg>
            <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor" style="display: none;">
              <rect x="6" y="4" width="4" height="16"></rect>
              <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
          </button>
          <div class="podcast-info" onclick="playPodcast('${podcast.id}')">
            <h3 class="podcast-title">${escapeHtml(podcast.sourceFileName || podcast.title)}</h3>
            <div class="podcast-meta">
              <span class="podcast-source">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
                ${podcast.accountName ? escapeHtml(podcast.accountName) : '微信公众号平台'}
              </span>
              <span class="meta-dot"></span>
              <span class="podcast-duration" data-duration="${podcast.durationMs || 0}">${formatDuration(podcast.durationMs, true)}</span>
              <span class="meta-dot"></span>
              <span>${formatFileSize(podcast.fileSizeBytes)}</span>
              <span class="meta-dot"></span>
              <span>${formatTime(podcast.generatedAt || podcast.createdAt)}</span>
            </div>
            <p class="podcast-preview">${escapeHtml(podcast.summary || podcast.scriptPreview || '暂无简介')}</p>
          </div>
          <div class="podcast-actions">
            <button onclick="event.stopPropagation(); downloadPodcast('${podcast.id}', '${escapeHtml(podcast.sourceFileName || 'podcast')}')">下载</button>
            <button class="delete-btn" onclick="event.stopPropagation(); deletePodcast('${podcast.id}')">删除</button>
          </div>
        </div>
        <div class="podcast-mobile-actions">
          <button onclick="event.stopPropagation(); downloadPodcast('${podcast.id}', '${escapeHtml(podcast.sourceFileName || 'podcast')}')">下载</button>
          <button class="delete-btn" onclick="event.stopPropagation(); deletePodcast('${podcast.id}')">删除</button>
        </div>
      </div>
    `).join('');

    // 更新正在播放的卡片按钮状态
    updatePlayingCardState();

  } catch (error) {
    console.error('加载播客列表失败:', error);
  }
}

// 更新正在播放的卡片状态
function updatePlayingCardState() {
  document.querySelectorAll('.podcast-item').forEach(item => {
    const isPlaying = item.dataset.id === currentPodcastId && !audioPlayer.paused;
    const playIcon = item.querySelector('.podcast-play-btn .play-icon');
    const pauseIcon = item.querySelector('.podcast-play-btn .pause-icon');
    const durationEl = item.querySelector('.podcast-duration');

    if (item.dataset.id === currentPodcastId) {
      item.classList.add('playing');
      if (playIcon && pauseIcon) {
        playIcon.style.display = isPlaying ? 'none' : 'block';
        pauseIcon.style.display = isPlaying ? 'block' : 'none';
      }
    } else {
      item.classList.remove('playing');
      if (playIcon && pauseIcon) {
        playIcon.style.display = 'block';
        pauseIcon.style.display = 'none';
      }
      // 非播放卡片恢复原始时长显示
      if (durationEl) {
        const originalDuration = parseInt(durationEl.dataset.duration) || 0;
        durationEl.textContent = formatDuration(originalDuration, true);
      }
    }
  });
}

// 更新正在播放卡片的时间显示
function updatePlayingCardTime() {
  if (!currentPodcastId) return;
  const playingItem = document.querySelector(`.podcast-item[data-id="${currentPodcastId}"]`);
  if (!playingItem) return;

  const durationEl = playingItem.querySelector('.podcast-duration');
  if (durationEl && audioPlayer.duration) {
    const currentTime = formatDuration(audioPlayer.currentTime * 1000);
    const totalTime = formatDuration(audioPlayer.duration * 1000);
    durationEl.textContent = `${currentTime} / ${totalTime}`;
  }
}

// 播放播客
async function playPodcast(id) {
  try {
    // 如果点击的是当前播放的，切换播放/暂停
    if (currentPodcastId === id) {
      togglePlay();
      return;
    }

    const response = await authFetch(`/api/podcasts/${id}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || '获取播客信息失败');
    }

    const podcast = data.podcast || data; // 兼容两种格式

    currentPodcastId = id;
    currentPodcastData = podcast; // 保存完整播客数据
    playerTitle.textContent = podcast.sourceFileName || podcast.title;
    playerAccount.textContent = podcast.accountName || '微信公众号平台';
    // v2.0: 使用 API 端点获取音频
    audioPlayer.src = `/api/podcasts/audio/${id}`;
    audioPlayer.play();
    playerSection.style.display = 'block';

    // 更新列表高亮和按钮状态
    updatePlayingCardState();

  } catch (error) {
    console.error('播放失败:', error);
    alert('播放失败: ' + error.message);
  }
}

// 播放/暂停
function togglePlay() {
  if (audioPlayer.paused) {
    audioPlayer.play();
  } else {
    audioPlayer.pause();
  }
  updatePlayingCardState();
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

    // 同步详情页进度
    if (isDetailOpen) {
      syncDetailProgress();
    }

    // 同步列表卡片时间显示
    updatePlayingCardTime();
  }
}

function updateDuration() {
  totalTimeEl.textContent = formatDuration(audioPlayer.duration * 1000);
  // 同步列表卡片时间显示
  updatePlayingCardTime();
  // 同步详情页时长
  if (detailTotalTime) {
    detailTotalTime.textContent = formatDuration(audioPlayer.duration * 1000);
  }
}

// 播放结束
function handleEnded() {
  updatePlayButtonState(false);
  playerVisualizer?.classList.remove('playing');
  updatePlayingCardState();
}

// 倍速控制
function handleSpeedChange() {
  audioPlayer.playbackRate = parseFloat(speedSelect.value);
  syncDetailSpeedDisplay(speedSelect.value);
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
  // v2.0: 使用 API 端点下载
  link.href = `/api/podcasts/audio/${id}`;
  link.download = `${filename}.mp3`;
  link.click();
}

// 删除播客
async function deletePodcast(id) {
  if (!confirm('确定要删除这个播客吗？')) return;

  try {
    const response = await authFetch(`/api/podcasts/${id}`, { method: 'DELETE' });

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
function formatDuration(ms, showPlaceholder = false) {
  if (!ms || ms <= 0) return showPlaceholder ? '--:--' : '0:00';
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

// ==================== 详情页功能 ====================

// 打开详情页
function openDetail() {
  if (!currentPodcastData) return;

  // 填充详情页内容
  detailTitle.textContent = currentPodcastData.sourceFileName || currentPodcastData.title || '';
  detailAccount.textContent = currentPodcastData.accountName || '微信公众号平台';
  detailDescription.textContent = currentPodcastData.summary || currentPodcastData.scriptPreview || '暂无简介';

  // 更新原文按钮状态
  if (currentPodcastData.sourceUrl) {
    detailSourceBtn.disabled = false;
    detailSourceBtn.title = '';
  } else {
    detailSourceBtn.disabled = true;
    detailSourceBtn.title = '原文链接不可用';
  }

  // 同步当前倍速
  syncDetailSpeedDisplay(speedSelect.value);

  // 同步播放状态
  updateDetailPlayButtonState(!audioPlayer.paused);

  // 同步进度
  syncDetailProgress();

  // 显示详情页
  detailOverlay.style.display = 'block';
  detailDrawer.style.display = 'flex';

  // 触发动画
  requestAnimationFrame(() => {
    detailOverlay.classList.add('visible');
    detailDrawer.classList.add('visible');
  });

  isDetailOpen = true;
}

// 关闭详情页
function closeDetail() {
  detailOverlay.classList.remove('visible');
  detailDrawer.classList.remove('visible');

  setTimeout(() => {
    detailOverlay.style.display = 'none';
    detailDrawer.style.display = 'none';
  }, 300);

  isDetailOpen = false;
}

// 更新详情页播放按钮状态
function updateDetailPlayButtonState(isPlaying) {
  const playIcon = detailPlayBtn?.querySelector('.play-icon');
  const pauseIcon = detailPlayBtn?.querySelector('.pause-icon');
  if (playIcon && pauseIcon) {
    playIcon.style.display = isPlaying ? 'none' : 'block';
    pauseIcon.style.display = isPlaying ? 'block' : 'none';
  }
}

// 同步详情页进度
function syncDetailProgress() {
  if (audioPlayer.duration) {
    const progress = (audioPlayer.currentTime / audioPlayer.duration) * 100;
    if (detailProgress) detailProgress.value = progress;
    if (detailCurrentTime) detailCurrentTime.textContent = formatDuration(audioPlayer.currentTime * 1000);
    if (detailTotalTime) detailTotalTime.textContent = formatDuration(audioPlayer.duration * 1000);
  }
}

// 详情页进度拖动
function handleDetailSeek() {
  const time = (detailProgress.value / 100) * audioPlayer.duration;
  audioPlayer.currentTime = time;
}

// 快进/快退
function seekRelative(seconds) {
  if (!audioPlayer.duration) return;
  let newTime = audioPlayer.currentTime + seconds;
  newTime = Math.max(0, Math.min(newTime, audioPlayer.duration));
  audioPlayer.currentTime = newTime;
  syncDetailProgress();
  updateProgress();
}

// 切换倍速菜单
function toggleSpeedMenu(e) {
  e.stopPropagation();
  const isVisible = detailSpeedMenu.style.display === 'block';
  detailSpeedMenu.style.display = isVisible ? 'none' : 'block';
}

// 详情页倍速切换
function handleDetailSpeedChange(speed) {
  audioPlayer.playbackRate = speed;
  speedSelect.value = speed;
  syncDetailSpeedDisplay(speed);
  detailSpeedMenu.style.display = 'none';
}

// 分享功能
async function handleShare() {
  if (!currentPodcastData) return;

  // v2.0: 优先使用 shareId，若缺失则提示不可用
  const shareId = currentPodcastData.shareId;
  if (!shareId) {
    showToast('分享暂不可用');
    return;
  }
  const title = currentPodcastData.title ? currentPodcastData.title : '';
  const encodedTitle = title ? `&title=${encodeURIComponent(title)}` : '';
  const shareUrl = `${window.location.origin}${window.location.pathname}?share=${shareId}${encodedTitle}`;

  try {
    // 优先使用 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(shareUrl);
      showToast('链接已复制到剪贴板');
    } else {
      // 降级方案
      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      const success = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (success) {
        showToast('链接已复制到剪贴板');
      } else {
        showToast('复制失败，请手动复制');
      }
    }
  } catch (err) {
    console.error('复制失败:', err);
    showToast('复制失败，请手动复制');
  }
}

// 查看原文
function handleViewSource() {
  if (currentPodcastData?.sourceUrl) {
    window.open(currentPodcastData.sourceUrl, '_blank');
  } else {
    showToast('原文链接不可用');
  }
}

// Toast 提示
function showToast(message, duration = 2000) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.style.display = 'block';

  requestAnimationFrame(() => {
    toastEl.classList.add('visible');
  });

  setTimeout(() => {
    toastEl.classList.remove('visible');
    setTimeout(() => {
      toastEl.style.display = 'none';
    }, 300);
  }, duration);
}

function shouldOpenDetailFromPlayer(event) {
  if (!playerSection || playerSection.style.display === 'none') return false;
  const target = event.target;
  if (target.closest('button') || target.closest('input') || target.closest('select')) {
    return false;
  }
  if (target.closest('.player-controls') || target.closest('.player-actions') || target.closest('.player-progress-wrapper')) {
    return false;
  }
  return true;
}

function syncDetailSpeedDisplay(speedValue) {
  if (!detailSpeedText || !detailSpeedMenu) return;
  const normalized = String(speedValue);
  detailSpeedText.textContent = `${normalized}x`;
  detailSpeedMenu.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.speed === normalized);
  });
}

// 处理分享链接
async function handleShareLink() {
  const urlParams = new URLSearchParams(window.location.search);
  const shareId = urlParams.get('share');
  const podcastId = urlParams.get('podcast'); // 兼容旧链接

  if (shareId) {
    // v2.0: 使用 shareId 访问分享播客
    try {
      await new Promise(resolve => setTimeout(resolve, 300));

      const response = await fetch(`/api/share/${shareId}`);
      if (!response.ok) {
        throw new Error('播客不存在或已过期');
      }

      const data = await response.json();
      const podcast = data.podcast;

      // 设置当前播客数据
      currentPodcastId = podcast.id;
      currentPodcastData = podcast;
      playerTitle.textContent = podcast.title || '';
      playerAccount.textContent = podcast.accountName || '微信公众号平台';
      // 使用分享音频端点
      audioPlayer.src = `/api/share/${shareId}/audio`;
      playerSection.style.display = 'block';

      // 打开详情页但不自动播放
      openDetail();

    } catch (error) {
      console.error('加载分享播客失败:', error);
      showToast('播客不存在或已过期');
    }
  } else if (podcastId) {
    // 兼容旧的 ?podcast= 链接格式
    try {
      await new Promise(resolve => setTimeout(resolve, 300));

      const response = await authFetch(`/api/podcasts/${podcastId}`);
      if (!response.ok) {
        throw new Error('播客不存在');
      }

      const data = await response.json();
      const podcast = data.podcast || data;

      currentPodcastId = podcastId;
      currentPodcastData = podcast;
      playerTitle.textContent = podcast.sourceFileName || podcast.title;
      playerAccount.textContent = podcast.accountName || '微信公众号平台';
      audioPlayer.src = `/api/podcasts/audio/${podcastId}`;
      playerSection.style.display = 'block';

      openDetail();

    } catch (error) {
      console.error('加载播客失败:', error);
      showToast('播客加载失败');
    }
  }
}
