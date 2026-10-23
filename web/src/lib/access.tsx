import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { SITE } from './site';
import { LOGIN_KEY, TOKEN_KEY, verifyAccess, type Access } from './github';

/**
 * 角色模型：谁能做什么。
 *
 * | 能力            | 访客 | 贡献者（有令牌但非站长） | 站长 |
 * |-----------------|------|--------------------------|------|
 * | 浏览            | ✓    | ✓                        | ✓    |
 * | 上传素材        | ✗    | ✓                        | ✓    |
 * | 编辑（点赞/上传者/下架） | ✗ | ✗                     | ✓    |
 *
 * 说清楚边界：**这是界面层的角色隔离，不是安全边界**。
 * 真正的安全边界是令牌本身 —— 没令牌的人无论怎么改前端都写不了仓库。
 * 反过来，拿到令牌的人就能写仓库，所以令牌不能随便发（见投稿指引里的说明）。
 */
export type Role = 'visitor' | 'contributor' | 'owner';

export interface AccessState {
  role: Role;
  login: string | null;
  avatarUrl: string | null;
  /** 上传素材：站长与贡献者 */
  canUpload: boolean;
  /** 编辑已入库内容：只有站长 */
  canEdit: boolean;
  checking: boolean;
  error: string | null;
  /** 已校验通过的令牌 */
  token: string;
  connect: (token: string) => Promise<boolean>;
  disconnect: () => void;
}

const AccessContext = createContext<AccessState | null>(null);

export function AccessProvider({ children }: { children: ReactNode }) {
  const { owner, name: repo } = SITE.repo;

  const [token, setToken] = useState('');
  const [info, setInfo] = useState<Access | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(
    async (candidate: string): Promise<boolean> => {
      const trimmed = candidate.trim();
      if (!trimmed) return false;
      setChecking(true);
      setError(null);
      try {
        const result = await verifyAccess(trimmed, owner, repo);
        setInfo(result);
        setToken(trimmed);
        window.localStorage.setItem(TOKEN_KEY, trimmed);
        window.localStorage.setItem(LOGIN_KEY, result.login);
        return true;
      } catch (err) {
        // 只在“令牌被拒”时清掉本地旧 token；网络抖动不该把用户踢下线。
        // 401/403/404 分别对应失效、权限不足、看不到这个仓库。
        const status = (err as { status?: number } | null)?.status;
        if (status === 401 || status === 403 || status === 404) {
          window.localStorage.removeItem(TOKEN_KEY);
          window.localStorage.removeItem(LOGIN_KEY);
        }
        setInfo(null);
        setToken('');
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setChecking(false);
      }
    },
    [owner, repo],
  );

  const disconnect = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(LOGIN_KEY);
    setInfo(null);
    setToken('');
    setError(null);
  }, []);

  // 进站时若有存过的令牌，静默校验一次
  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) void connect(stored);
  }, [connect]);

  const value = useMemo<AccessState>(() => {
    const withPush = Boolean(info?.canPush);
    const role: Role = !info || !withPush ? 'visitor' : info.login === owner ? 'owner' : 'contributor';
    return {
      role,
      login: info?.login ?? null,
      avatarUrl: info?.avatarUrl ?? null,
      canUpload: role === 'owner' || role === 'contributor',
      canEdit: role === 'owner',
      checking,
      error,
      token,
      connect,
      disconnect,
    };
  }, [info, checking, error, token, connect, disconnect, owner]);

  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

export function useAccess(): AccessState {
  const context = useContext(AccessContext);
  if (!context) throw new Error('useAccess 必须在 AccessProvider 内使用');
  return context;
}
