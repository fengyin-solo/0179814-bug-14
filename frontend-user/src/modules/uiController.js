import { Logger } from '../utils/logger.js';

const logger = new Logger('UIController');

/**
 * UI 控制器 - 负责界面状态管理和交互
 */
export class UIController {
  constructor() {
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.loadingText = document.getElementById('loadingMessage');
    this.loadingProgress = document.getElementById('loadingProgress');
    this.loadingProgressBar = document.getElementById('loadingProgressBar');
    this.loadingProgressText = document.getElementById('loadingProgressText');
    this.cancelLoadingBtn = document.getElementById('cancelLoadingBtn');
    this.analysisProgress = document.getElementById('analysisProgress');
    this.onCancelLoading = null;

    if (this.cancelLoadingBtn) {
      this.cancelLoadingBtn.addEventListener('click', () => {
        if (this.onCancelLoading) {
          this.onCancelLoading();
        }
      });
    }
  }

  /**
   * 显示加载状态（纯提示，无进度条和取消按钮）
   * @param {string} message - 加载提示信息
   */
  showLoading(message = '加载中...') {
    if (this.loadingOverlay) {
      if (this.loadingText) {
        this.loadingText.textContent = message;
      }
      if (this.loadingProgress) {
        this.loadingProgress.style.display = 'none';
      }
      if (this.loadingProgressText) {
        this.loadingProgressText.style.display = 'none';
      }
      if (this.cancelLoadingBtn) {
        this.cancelLoadingBtn.style.display = 'none';
      }
      this.onCancelLoading = null;
      this.loadingOverlay.style.display = 'flex';
    }
    logger.info('显示加载状态', { message });
  }

  /**
   * 显示分析加载状态（带进度条和取消按钮）
   * @param {string} message - 加载提示信息
   * @param {Function} onCancel - 点击取消按钮时的回调
   */
  showAnalysisLoading(message = '正在分析音频...', onCancel = null) {
    this.showLoading(message);
    if (this.loadingProgress) {
      this.loadingProgress.style.display = 'block';
    }
    if (this.loadingProgressText) {
      this.loadingProgressText.style.display = 'block';
    }
    if (this.cancelLoadingBtn) {
      this.cancelLoadingBtn.style.display = 'inline-block';
      this.cancelLoadingBtn.disabled = false;
    }
    this.onCancelLoading = onCancel;
    if (this.analysisProgress) {
      this.analysisProgress.style.display = 'flex';
    }
    this.updateAnalysisProgress(0, message);
    logger.info('显示分析加载状态', { message });
  }

  /**
   * 更新分析进度，遮罩层与面板内联进度由同一份数据驱动，保持两处同步
   * @param {number} percent - 进度值 (0-100)
   * @param {string} message - 可选的阶段提示信息
   */
  updateAnalysisProgress(percent, message = null) {
    const clamped = Math.min(100, Math.max(0, Math.round(percent)));

    if (this.loadingProgressBar) {
      this.loadingProgressBar.style.width = `${clamped}%`;
    }
    if (this.loadingProgressText) {
      this.loadingProgressText.textContent = `${clamped}%`;
    }
    if (message && this.loadingText) {
      this.loadingText.textContent = message;
    }

    const inlineBar = document.getElementById('analysisProgressBar');
    const inlineText = document.getElementById('analysisProgressText');
    if (inlineBar) {
      inlineBar.style.width = `${clamped}%`;
    }
    if (inlineText) {
      inlineText.textContent = `${clamped}%`;
    }
  }

  /**
   * 隐藏加载状态
   */
  hideLoading() {
    if (this.loadingOverlay) {
      this.loadingOverlay.style.display = 'none';
    }
    this.onCancelLoading = null;
    logger.info('隐藏加载状态');
  }

  /**
   * 结束分析加载状态，并复位所有进度显示，避免残留中间状态
   */
  hideAnalysisLoading() {
    this.hideLoading();
    this.updateAnalysisProgress(0);
    if (this.analysisProgress) {
      this.analysisProgress.style.display = 'none';
    }
  }

  /**
   * 设置分析按钮的忙碌/空闲状态
   * @param {boolean} isBusy - 是否正在分析
   * @param {boolean} canAnalyze - 空闲时是否允许分析（是否已加载音频）
   */
  setAnalyzeButtonBusy(isBusy, canAnalyze = true) {
    const button = document.getElementById('analyzeBtn');
    if (!button) return;

    button.disabled = isBusy || !canAnalyze;
    button.innerHTML = isBusy
      ? '<span class="btn-icon">⏳</span> 分析中...'
      : '<span class="btn-icon">📊</span> 分析音频';
  }

  /**
   * 显示提示消息
   * @param {string} message - 消息内容
   * @param {string} type - 消息类型 (success, warning, error, info)
   */
  showToast(message, type = 'info') {
    // 创建 toast 元素
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    // 添加样式
    Object.assign(toast.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      padding: '12px 24px',
      borderRadius: '8px',
      color: 'white',
      fontWeight: '500',
      zIndex: '1001',
      animation: 'slideIn 0.3s ease',
      backgroundColor: this.getToastColor(type)
    });

    document.body.appendChild(toast);

    // 3秒后自动移除
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);

    logger.info('显示提示消息', { message, type });
  }

  /**
   * 获取 toast 颜色
   */
  getToastColor(type) {
    const colors = {
      success: '#4CAF50',
      warning: '#FF9800',
      error: '#F44336',
      info: '#2196F3'
    };
    return colors[type] || colors.info;
  }

  /**
   * 格式化时间显示
   * @param {number} ms - 毫秒数
   * @returns {string} 格式化的时间字符串
   */
  formatTime(ms) {
    const seconds = Math.floor(ms / 1000);
    const milliseconds = ms % 1000;
    return `${seconds}.${milliseconds.toString().padStart(3, '0')}`;
  }

  /**
   * 格式化频率显示
   * @param {number} freq - 频率 (Hz)
   * @returns {string} 格式化的频率字符串
   */
  formatFrequency(freq) {
    if (freq >= 1000) {
      return `${(freq / 1000).toFixed(2)} kHz`;
    }
    return `${freq.toFixed(2)} Hz`;
  }

  /**
   * 更新进度条
   * @param {number} progress - 进度值 (0-100)
   * @param {string} elementId - 进度条元素 ID
   */
  updateProgress(progress, elementId) {
    const progressBar = document.getElementById(elementId);
    if (progressBar) {
      progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
    }
  }

  /**
   * 禁用/启用按钮
   * @param {string} buttonId - 按钮元素 ID
   * @param {boolean} disabled - 是否禁用
   */
  setButtonDisabled(buttonId, disabled) {
    const button = document.getElementById(buttonId);
    if (button) {
      button.disabled = disabled;
    }
  }

  /**
   * 切换元素可见性
   * @param {string} elementId - 元素 ID
   * @param {boolean} visible - 是否可见
   */
  toggleVisibility(elementId, visible) {
    const element = document.getElementById(elementId);
    if (element) {
      element.style.display = visible ? 'block' : 'none';
    }
  }
}
