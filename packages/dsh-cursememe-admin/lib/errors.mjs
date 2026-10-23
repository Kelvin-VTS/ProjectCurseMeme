/**
 * 站长能力的统一错误类型。
 *
 * 所有会打到模型/命令行上的失败都尽量带一个稳定的 code，方便调用方区分
 * 「没配好」「token 失效」「文件不合格」「GitHub 拒绝」这些完全不同的处理方式。
 */
export class AdminError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, status?: number, details?: unknown }} [options]
   */
  constructor(message, { code = 'ADMIN_ERROR', status = 0, details = undefined } = {}) {
    super(message);
    this.name = 'AdminError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * @param {unknown} error
 * @returns {error is AdminError}
 */
export function isAdminError(error) {
  return error instanceof AdminError;
}
