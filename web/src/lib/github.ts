/**
 * 浏览器直连 GitHub REST API（上传页用）。
 *
 * 为什么用 XHR 而不是 fetch：fetch 拿不到**上传**进度，而上传几十 MB 的素材时
 * 没有进度条体验很差。XHR 的 upload.onprogress 能给出已发送字节数。
 *
 * 安全边界：token 只存在使用者的浏览器 localStorage，不进仓库、不进构建产物。
 * 上传页本身是公开的，但没有 token 的人打开只会看到一堆死按钮。
 */

const API = 'https://api.github.com';

export const TOKEN_KEY = 'cursememe:pat';
export const LOGIN_KEY = 'cursememe:pat-login';

/** jsDelivr / GitHub 对单个 blob 的实际上限是 100MB；base64 还要再涨 1/3 */
export const WARN_FILE_SIZE = 30 * 1024 * 1024;
export const MAX_FILE_SIZE = 80 * 1024 * 1024;

export interface UploadProgress {
  loaded: number;
  total: number;
}

export interface Access {
  login: string;
  avatarUrl: string;
  canPush: boolean;
  repoFullName: string;
}

class GithubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GithubError';
  }
}

function request<T>(
  method: string,
  url: string,
  token: string,
  body?: unknown,
  onProgress?: (progress: UploadProgress) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    xhr.setRequestHeader('Accept', 'application/vnd.github+json');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('X-GitHub-Api-Version', '2022-11-28');
    if (body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.timeout = 300000;

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress({ loaded: event.loaded, total: event.total });
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (!xhr.responseText) {
          resolve(undefined as T);
          return;
        }
        try {
          resolve(JSON.parse(xhr.responseText) as T);
        } catch {
          reject(new GithubError('返回内容不是 JSON', xhr.status));
        }
        return;
      }
      let message = `HTTP ${xhr.status}`;
      try {
        const parsed = JSON.parse(xhr.responseText) as { message?: string };
        if (parsed.message) message = `${xhr.status} ${parsed.message}`;
      } catch {
        /* 保持默认信息 */
      }
      reject(new GithubError(message, xhr.status));
    };
    xhr.onerror = () =>
      reject(new GithubError('网络错误（可能是浏览器拦了跨域请求，或网络不通）', 0));
    xhr.ontimeout = () => reject(new GithubError('请求超时（大文件上传较慢时属正常，请检查网络）', 0));

    xhr.send(body === undefined ? null : JSON.stringify(body));
  });
}

/** 校验 token 可用性、是否有该仓库的写权限 */
export async function verifyAccess(token: string, owner: string, repo: string): Promise<Access> {
  const user = await request<{ login: string; avatar_url: string }>('GET', `${API}/user`, token);
  const target = await request<{ full_name: string; permissions?: { push?: boolean } }>(
    'GET',
    `${API}/repos/${owner}/${repo}`,
    token,
  );
  return {
    login: user.login,
    avatarUrl: user.avatar_url,
    canPush: Boolean(target.permissions?.push),
    repoFullName: target.full_name,
  };
}

async function getDefaultBranchSha(token: string, owner: string, repo: string): Promise<string> {
  const ref = await request<{ object: { sha: string } }>(
    'GET',
    `${API}/repos/${owner}/${repo}/git/ref/heads/main`,
    token,
  );
  return ref.object.sha;
}

async function getBaseTreeSha(
  token: string,
  owner: string,
  repo: string,
  commitSha: string,
): Promise<string> {
  const commit = await request<{ tree: { sha: string } }>(
    'GET',
    `${API}/repos/${owner}/${repo}/git/commits/${commitSha}`,
    token,
  );
  return commit.tree.sha;
}

/** File → 去掉 data URL 前缀的 base64 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}

/** 只保留安全字符，避免路径穿越和 git 不喜欢的东西 */
function safeName(index: number, original: string): string {
  const dot = original.lastIndexOf('.');
  const ext = dot > 0 ? original.slice(dot).toLowerCase().replace(/[^a-z0-9.]/g, '') : '';
  const stem = (dot > 0 ? original.slice(0, dot) : original)
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'file';
  return `${String(index + 1).padStart(3, '0')}-${stem}${ext}`;
}

export interface BatchMeta {
  batch: string;
  login: string;
  date?: string;
  group?: string;
  tags: string[];
}

export type FilePhase = 'encode' | 'upload' | 'done' | 'failed';

export interface FileStatusEvent {
  index: number;
  name: string;
  phase: FilePhase;
  sent?: number;
  total?: number;
  error?: string;
}

export interface BatchResult {
  branch: string;
  commitSha: string;
  commitUrl: string;
  branchUrl: string;
}

export interface IngestRun {
  phase: 'queued' | 'in_progress' | 'completed' | 'unknown';
  conclusion: string | null;
  htmlUrl: string;
  workflowName: string;
}

/**
 * 查某个分支上的 ingest 运行状态，用来在页面上直接告诉站长处理结果。
 * 刻意**不带 token**：公开仓库匿名就能读；而 fine-grained token 若没勾
 * Actions 权限反而会被拒，也省得为了看个进度再去扩权。
 */
export async function fetchIngestRun(
  owner: string,
  repo: string,
  branch: string,
): Promise<IngestRun | null> {
  const response = await fetch(`${API}/repos/${owner}/${repo}/actions/runs?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) throw new Error(`查询运行状态失败 HTTP ${response.status}`);

  const data = (await response.json()) as {
    workflow_runs?: Array<{
      name?: string;
      head_branch?: string;
      status?: string;
      conclusion?: string | null;
      html_url?: string;
    }>;
  };

  const run = (data.workflow_runs ?? []).find((item) => item.head_branch === branch);
  if (!run) return null;

  const phase =
    run.status === 'queued' || run.status === 'in_progress' || run.status === 'completed'
      ? run.status
      : 'unknown';

  return {
    phase,
    conclusion: run.conclusion ?? null,
    htmlUrl: run.html_url ?? '',
    workflowName: run.name ?? '',
  };
}

/**
 * 一批素材 → 一个 staging 分支上的一个提交。
 * 分支被推送后会触发 ingest workflow，由 runner 用真 ffmpeg 处理。
 */
export async function uploadBatch(options: {
  token: string;
  owner: string;
  repo: string;
  files: File[];
  meta: BatchMeta;
  onFile?: (event: FileStatusEvent) => void;
}): Promise<BatchResult> {
  const { token, owner, repo, files, meta, onFile } = options;

  const baseSha = await getDefaultBranchSha(token, owner, repo);
  const baseTreeSha = await getBaseTreeSha(token, owner, repo, baseSha);

  const entries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  const usedNames = new Set<string>();

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    let name = safeName(index, file.name);
    while (usedNames.has(name)) name = `dup-${name}`;
    usedNames.add(name);

    try {
      onFile?.({ index, name: file.name, phase: 'encode' });
      const content = await fileToBase64(file);

      onFile?.({ index, name: file.name, phase: 'upload', sent: 0, total: content.length });
      const blob = await request<{ sha: string }>(
        'POST',
        `${API}/repos/${owner}/${repo}/git/blobs`,
        token,
        { content, encoding: 'base64' },
        (progress) => onFile?.({ index, name: file.name, phase: 'upload', sent: progress.loaded, total: progress.total }),
      );

      entries.push({ path: `incoming/${name}`, mode: '100644', type: 'blob', sha: blob.sha });
      onFile?.({ index, name: file.name, phase: 'done' });
    } catch (error) {
      onFile?.({
        index,
        name: file.name,
        phase: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  // job.json 一起提交，ingest 侧只认这个文件
  const job = {
    version: 1,
    batch: meta.batch,
    login: meta.login,
    createdAt: new Date().toISOString(),
    ...(meta.date ? { date: meta.date } : {}),
    ...(meta.group ? { group: meta.group } : {}),
    ...(meta.tags.length > 0 ? { tags: meta.tags } : {}),
    files: entries.map((entry) => entry.path.replace('incoming/', '')),
  };
  const jobBlob = await request<{ sha: string }>(
    'POST',
    `${API}/repos/${owner}/${repo}/git/blobs`,
    token,
    { content: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(job, null, 2)))), encoding: 'base64' },
  );
  entries.push({ path: 'incoming/job.json', mode: '100644', type: 'blob', sha: jobBlob.sha });

  const tree = await request<{ sha: string }>('POST', `${API}/repos/${owner}/${repo}/git/trees`, token, {
    base_tree: baseTreeSha,
    tree: entries,
  });

  const branch = `staging/${meta.batch}`;
  const commit = await request<{ sha: string; html_url: string }>(
    'POST',
    `${API}/repos/${owner}/${repo}/git/commits`,
    token,
    {
      message: `upload: ${files.length} 个素材（${meta.batch}）`,
      tree: tree.sha,
      parents: [baseSha],
    },
  );

  await request('POST', `${API}/repos/${owner}/${repo}/git/refs`, token, {
    ref: `refs/heads/${branch}`,
    sha: commit.sha,
  });

  return {
    branch,
    commitSha: commit.sha,
    commitUrl: commit.html_url,
    branchUrl: `https://github.com/${owner}/${repo}/tree/${branch}`,
  };
}
