import { Logger } from '../utils/logger.js';

const logger = new Logger('AnalysisManager');

const STORAGE_KEY = 'guqin_audio_analysis_state';
const OWNER_KEY = 'guqin_audio_analysis_owner';
const HEARTBEAT_INTERVAL = 1000; // 运行中心跳，用于识别已崩溃的任务
const STALE_TIMEOUT = 8000; // 超过该时长没有心跳的运行态任务视为残留

export const ANALYSIS_STATUS = {
  IDLE: 'idle',
  RUNNING: 'running',
  DONE: 'done',
  ERROR: 'error',
  CANCELLED: 'cancelled'
};

/**
 * 分析任务管理器
 *
 * 职责：
 * - 保证同一时间只有一个分析任务（重复提交直接忽略）
 * - 维护统一的分析状态（idle/running/done/error/cancelled）与进度
 * - 支持中途取消（AbortSignal）
 * - 状态持久化到 localStorage，刷新 / 切走再回来后可恢复到可操作状态
 * - 通过订阅者 + storage 事件，让两个入口（面板按钮 / 空状态按钮）与跨标签页的进度同步
 */
export class AnalysisManager {
  constructor() {
    // 标签页级 ID：存在 sessionStorage 中，刷新后保持不变，标签页关闭即清除。
    // 因此刷新后仍能认出"自己持有的、但 AbortController 已失效"的残留任务。
    this.ownerId = this.getOrCreateOwnerId();
    this.listeners = new Set();
    this.currentController = null;
    this.heartbeatTimer = null;
    this.persistTimer = null;
    this.lastPersistedAt = 0;

    this.state = this.restoreState();
    window.addEventListener('storage', (e) => this.handleStorageEvent(e));
  }

  getOrCreateOwnerId() {
    try {
      let id = sessionStorage.getItem(OWNER_KEY);
      if (!id) {
        id = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        sessionStorage.setItem(OWNER_KEY, id);
      }
      return id;
    } catch {
      return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
  }

  /**
   * 订阅状态变化
   * @param {Function} listener - 状态回调
   * @returns {Function} 取消订阅函数
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return this.state;
  }

  isRunning() {
    return this.state.status === ANALYSIS_STATUS.RUNNING;
  }

  /** 是否由当前标签页持有（只有持有者才显示遮罩、允许取消） */
  isOwnedByCurrentTab() {
    return this.isRunning() && this.state.ownerId === this.ownerId;
  }

  /**
   * 恢复持久化状态：
   * - 本标签页持有的运行态一定是刷新前的残留任务（AbortController 已失效），重置
   * - 其他标签页持有的运行态，按心跳判断是否还活着；活着则镜像，否则重置
   * - 任何终态（done/error/cancelled）在新页面里都不可展示，重置为可操作状态
   */
  restoreState() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (error) {
      logger.warn('恢复分析状态失败', error);
    }

    if (!saved) {
      return { status: ANALYSIS_STATUS.IDLE, progress: 0, message: '', ownerId: null, updatedAt: 0 };
    }

    if (saved.status === ANALYSIS_STATUS.RUNNING) {
      // 自己持有的任务在刷新后必定已经死亡（AbortController 随页面销毁）；
      // 其他标签页的任务按心跳判断是否还活着，活着则镜像，否则重置。
      const age = Date.now() - (saved.updatedAt || 0);
      if (saved.ownerId === this.ownerId || age > STALE_TIMEOUT) {
        logger.info('发现残留的运行中分析任务，重置为空闲状态', { age, mine: saved.ownerId === this.ownerId });
        return this.idleState();
      }
      return saved;
    }

    return this.idleState();
  }

  idleState() {
    return { status: ANALYSIS_STATUS.IDLE, progress: 0, message: '', ownerId: null, updatedAt: Date.now() };
  }

  /**
   * 运行分析任务。已有任务在跑（本地或其他标签页）时直接忽略。
   *
   * @param {Object} taskMeta - 任务信息（fileName/startMs/endMs 等）
   * @param {Function} taskFn - async (onProgress, signal) => result
   * @returns {Promise<{status: string, result?: *, error?: Error}>}
   */
  async run(taskMeta, taskFn) {
    if (this.isRunning()) {
      logger.warn('已有分析任务在进行中，忽略重复提交', { current: this.state });
      return { status: this.state.status };
    }

    const controller = new AbortController();
    this.currentController = controller;

    this.updateState({
      status: ANALYSIS_STATUS.RUNNING,
      progress: 0,
      message: '准备分析...',
      error: '',
      ownerId: this.ownerId,
      task: taskMeta || null,
      updatedAt: Date.now()
    }, { immediate: true });

    this.startHeartbeat();

    const onProgress = (progress, message) => {
      if (controller.signal.aborted) return;
      this.updateState({
        progress: Math.min(100, Math.max(0, progress)),
        message: message || this.state.message
      });
    };

    try {
      // 先让出一帧，确保“分析中”的 UI 渲染出来后再开始重计算
      await this.nextFrame();
      this.throwIfAborted(controller.signal);

      const result = await taskFn(onProgress, controller.signal);
      this.throwIfAborted(controller.signal);

      this.stopHeartbeat();
      this.updateState({
        status: ANALYSIS_STATUS.DONE,
        progress: 100,
        message: '分析完成',
        ownerId: this.ownerId,
        updatedAt: Date.now()
      }, { immediate: true });

      // 短暂展示 100% 后回到可操作状态
      setTimeout(() => {
        if (this.state.status === ANALYSIS_STATUS.DONE && this.state.ownerId === this.ownerId) {
          this.reset();
        }
      }, 1200);

      return { status: ANALYSIS_STATUS.DONE, result };
    } catch (error) {
      this.stopHeartbeat();

      if (controller.signal.aborted || error?.name === 'AbortError') {
        this.updateState({
          status: ANALYSIS_STATUS.CANCELLED,
          progress: 0,
          message: '分析已取消',
          error: '',
          ownerId: this.ownerId,
          updatedAt: Date.now()
        }, { immediate: true });
        logger.info('分析任务已取消');
        setTimeout(() => this.reset(), 800);
        return { status: ANALYSIS_STATUS.CANCELLED, error };
      }

      this.updateState({
        status: ANALYSIS_STATUS.ERROR,
        progress: 0,
        message: '分析失败',
        error: error?.message || String(error),
        ownerId: this.ownerId,
        updatedAt: Date.now()
      }, { immediate: true });
      logger.error('分析任务失败', error);
      // 失败后回到可操作状态，按钮/进度条/遮罩全部释放
      setTimeout(() => this.reset(), 1200);
      return { status: ANALYSIS_STATUS.ERROR, error };
    } finally {
      if (this.currentController === controller) {
        this.currentController = null;
      }
    }
  }

  /**
   * 取消当前分析任务。只能取消本标签页持有的任务。
   */
  cancel() {
    if (!this.isOwnedByCurrentTab() || !this.currentController) return;
    this.currentController.abort();
  }

  /**
   * 主动重置为空闲状态（完成 / 失败 / 取消后的收尾，或移除文件时调用）
   */
  reset() {
    this.stopHeartbeat();
    if (this.currentController) {
      this.currentController.abort();
      this.currentController = null;
    }
    this.updateState(this.idleState(), { immediate: true });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isOwnedByCurrentTab()) {
        this.updateState({ updatedAt: Date.now() }, { silent: true });
      }
    }, HEARTBEAT_INTERVAL);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * 页面重新可见 / 重新获得焦点时，与持久化状态对账：
   * 镜像其他标签页的进度，或回收残留任务。
   */
  resync() {
    if (this.isOwnedByCurrentTab()) return; // 自己的任务以内存状态为准

    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      return;
    }
    if (!saved) return;

    if (saved.status === ANALYSIS_STATUS.RUNNING) {
      const age = Date.now() - (saved.updatedAt || 0);
      if (age > STALE_TIMEOUT) {
        this.updateState(this.idleState(), { immediate: true });
      } else {
        this.updateState(saved);
      }
    } else if (this.isRunning()) {
      // 镜像中的任务在其他标签页结束了
      this.updateState(this.idleState(), { immediate: true });
    }
  }

  updateState(patch, options = {}) {
    this.state = { ...this.state, ...patch };

    if (this.state.status === ANALYSIS_STATUS.RUNNING && this.state.ownerId === this.ownerId) {
      if (options.immediate || Date.now() - this.lastPersistedAt > 250) {
        this.persist();
      }
    } else if (options.immediate) {
      this.persist();
    }

    if (!options.silent) {
      this.listeners.forEach((listener) => {
        try {
          listener(this.state);
        } catch (error) {
          logger.error('分析状态监听器执行失败', error);
        }
      });
    }
  }

  persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      this.lastPersistedAt = Date.now();
    } catch (error) {
      logger.warn('持久化分析状态失败', error);
    }
  }

  handleStorageEvent(event) {
    if (event.key !== STORAGE_KEY) return;

    // 自己刚写入的状态，内存中已经是最新，无需处理
    if (this.isOwnedByCurrentTab()) return;

    let remote = null;
    try {
      remote = JSON.parse(event.newValue);
    } catch {
      return;
    }
    if (!remote) return;

    if (remote.status === ANALYSIS_STATUS.RUNNING) {
      const age = Date.now() - (remote.updatedAt || 0);
      if (age > STALE_TIMEOUT) {
        if (this.isRunning()) this.updateState(this.idleState(), { immediate: true });
        return;
      }
      this.updateState(remote);
    } else if (this.isRunning()) {
      // 镜像的任务结束（完成 / 失败 / 取消 / 重置）
      this.updateState(this.idleState(), { immediate: true });
    }
  }

  throwIfAborted(signal) {
    if (signal.aborted) {
      const error = new DOMException('分析已取消', 'AbortError');
      throw error;
    }
  }

  nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }
}
