import { Logger } from '../utils/logger.js';
import { ANALYSIS_STATUS } from './analysisManager.js';

const logger = new Logger('UIController');

/**
 * UI 控制器 - 负责界面状态管理和交互
 */
export class UIController {
  constructor() {
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.loadingText = this.loadingOverlay?.querySelector('p') || null;
    this.loadingProgress = document.getElementById('loadingProgress');
    this.loadingProgressFill = document.getElementById('loadingProgressFill');
    this.loadingProgressText = document.getElementById('loadingProgressText');
    this.cancelAnalysisBtn = document.getElementById('cancelAnalysisBtn');
    // true 表示当前遮罩服务于分析流程（受分析状态机控制）
    this.overlayInAnalysisMode = false;

    // 两个分析入口共享的元素引用
    this.analyzeButtons = [
      document.getElementById('analyzeBtn'),
      document.getElementById('analyzeBtnEmpty')
    ].filter(Boolean);

    this.analysisProgressBars = [
      document.getElementById('analyzeProgressFill'),
      document.getElementById('analyzeProgressFillEmpty')
    ].filter(Boolean);

    this.analysisProgressTexts = [
      document.getElementById('analyzeProgressText'),
      document.getElementById('analyzeProgressTextEmpty')
    ].filter(Boolean);

    this.analysisProgressSections = [
      document.getElementById('analyzeProgress'),
      document.getElementById('analyzeProgressEmpty')
    ].filter(Boolean);

    // 空闲时按钮是否可用（取决于是否已加载音频）；运行中一律禁用
    this.analyzeAvailable = false;
  }

  /**
   * 设置分析入口的基础可用状态（音频加载/移除时调用）。
   * 实际禁用/启用仍由 syncAnalysisState 统一决定，运行中不会被提前启用。
   */
  setAnalyzeAvailable(available) {
    this.analyzeAvailable = available;
    this.syncAnalysisState(this.lastState || { status: ANALYSIS_STATUS.IDLE, progress: 0 }, this.lastOwned === true);
  }

  /**
   * 显示加载状态（文件上传等非分析场景使用）
   * @param {string} message - 加载提示信息
   */
  showLoading(message = '加载中...') {
    if (this.loadingOverlay) {
      if (this.loadingText) {
        this.loadingText.textContent = message;
      }
      this.setLoadingProgressVisible(false);
      if (this.cancelAnalysisBtn) {
        this.cancelAnalysisBtn.style.display = 'none';
      }
      this.overlayInAnalysisMode = false;
      this.loadingOverlay.style.display = 'flex';
    }
    logger.info('显示加载状态', { message });
  }

  /**
   * 隐藏加载状态。分析模式下的遮罩由分析状态机负责关闭，
   * 避免重复提交时后一个调用提前关掉遮罩。
   */
  hideLoading() {
    if (this.overlayInAnalysisMode) return;
    this._hideOverlay();
  }

  _hideOverlay() {
    if (this.loadingOverlay) {
      this.loadingOverlay.style.display = 'none';
    }
    this.overlayInAnalysisMode = false;
  }

  /**
   * 根据统一的分析状态同步全部相关 UI：
   * 加载提示、遮罩进度条、整体进度条、两个入口按钮的启用/禁用与文案。
   * @param {Object} state - AnalysisManager 的状态
   */
  syncAnalysisState(state, ownedLocally) {
    this.lastState = state;
    this.lastOwned = ownedLocally;
    const running = state.status === ANALYSIS_STATUS.RUNNING;
    const owned = running && ownedLocally;
    const progress = Math.min(100, Math.max(0, state.progress || 0));

    // 两个入口的按钮：运行中一律禁用；空闲时取决于是否已加载音频
    this.analyzeButtons.forEach((button) => {
      button.disabled = running || !this.analyzeAvailable;
      const label = button.querySelector('.btn-label');
      if (label) {
        label.textContent = running ? '分析中...' : '分析音频';
      }
    });

    // 两个入口的内联进度条：进度同步
    this.analysisProgressSections.forEach((section) => {
      section.style.display = running ? 'block' : 'none';
    });
    this.analysisProgressBars.forEach((bar) => {
      bar.style.width = `${progress}%`;
    });
    this.analysisProgressTexts.forEach((text) => {
      text.textContent = running ? `${Math.round(progress)}%` : '';
    });

    // 遮罩只有持有任务的标签页显示；其他标签页只镜像按钮与进度
    if (running && owned) {
      if (this.loadingOverlay) {
        this.overlayInAnalysisMode = true;
        if (this.loadingText) {
          this.loadingText.textContent = state.message || '正在分析音频...';
        }
        this.setLoadingProgressVisible(true);
        if (this.loadingProgressFill) {
          this.loadingProgressFill.style.width = `${progress}%`;
        }
        if (this.loadingProgressText) {
          this.loadingProgressText.textContent = `${Math.round(progress)}%`;
        }
        if (this.cancelAnalysisBtn) {
          this.cancelAnalysisBtn.style.display = 'inline-flex';
        }
        this.loadingOverlay.style.display = 'flex';
      }
    } else if (this.overlayInAnalysisMode && state.status === ANALYSIS_STATUS.DONE) {
      // 完成：进度条停在 100%，遮罩随状态机稍后自动关闭
      if (this.loadingText) this.loadingText.textContent = state.message || '分析完成';
      if (this.loadingProgressFill) this.loadingProgressFill.style.width = '100%';
      if (this.loadingProgressText) this.loadingProgressText.textContent = '100%';
      if (this.cancelAnalysisBtn) this.cancelAnalysisBtn.style.display = 'none';
    } else if (this.overlayInAnalysisMode && (state.status === ANALYSIS_STATUS.ERROR || state.status === ANALYSIS_STATUS.CANCELLED)) {
      // 失败 / 取消：显示最终提示，遮罩随状态机稍后自动关闭
      if (this.loadingText) {
        this.loadingText.textContent = state.status === ANALYSIS_STATUS.CANCELLED
          ? '分析已取消'
          : `分析失败${state.error ? '：' + state.error : ''}`;
      }
      this.setLoadingProgressVisible(false);
      if (this.cancelAnalysisBtn) this.cancelAnalysisBtn.style.display = 'none';
    } else if (this.overlayInAnalysisMode && (!running || !owned)) {
      // 回到 idle，或任务转为其他标签页持有：收尾遮罩
      this.setLoadingProgressVisible(false);
      if (this.cancelAnalysisBtn) {
        this.cancelAnalysisBtn.style.display = 'none';
      }
      this._hideOverlay();
    }
  }

  setLoadingProgressVisible(visible) {
    if (this.loadingProgress) {
      this.loadingProgress.style.display = visible ? 'block' : 'none';
    }
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
