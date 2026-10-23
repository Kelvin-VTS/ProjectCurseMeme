/**
 * 查某个分支触发的 Actions 运行状态。
 *
 * 公开仓库的 Actions 接口匿名就能读，所以这里刻意不带 token：
 * fine-grained PAT 没勾 Actions 权限时带 token 反而会被拒。
 *
 * @param {{ config: any, client: any }} admin
 * @param {string} branch
 */
export async function runStatus(admin, branch) {
  const { config, client } = admin;
  const name = String(branch ?? '').trim();
  if (!name) throw new Error('缺少分支名');

  const data = await client.listRuns(name, { auth: false });
  const runs = data?.workflow_runs ?? [];
  const run = runs.find((item) => item.head_branch === name);

  if (!run) {
    return {
      branch: name,
      phase: 'unknown',
      conclusion: null,
      htmlUrl: `https://github.com/${config.repo.owner}/${config.repo.name}/actions`,
      workflow: null,
      note: '还没有查到这次分支的运行记录；刚推上去时 GitHub 可能要几秒才调度。',
    };
  }

  return {
    branch: name,
    phase: run.status ?? 'unknown',
    conclusion: run.conclusion ?? null,
    htmlUrl: run.html_url ?? '',
    workflow: run.name ?? '',
    event: run.event ?? '',
    createdAt: run.created_at ?? '',
    updatedAt: run.updated_at ?? '',
  };
}
