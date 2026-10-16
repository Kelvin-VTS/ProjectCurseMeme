import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SITE } from '../lib/site';
import { useAccess } from '../lib/access';

/**
 * 访客投稿指引。
 *
 * 写成"三条路 + 风险说明"而不是一句"请联系站长"，是因为访客最常问的就三件事：
 * 发给谁、发的时候要带什么信息、以及能不能自己传。
 */

const TEMPLATE = `【投稿】
日期：
来源群：
标签（可多个）：
一句话说明：

（把这段连同图片/视频一起发给站长）`;

interface Method {
  badge: string;
  title: string;
  tone: 'accent' | 'accent2' | 'muted';
  available: boolean;
  summary: string;
  steps: string[];
}

const METHODS: Method[] = [
  {
    badge: '现在就能用',
    title: '一、直接发给站长',
    tone: 'accent',
    available: true,
    summary: '最省事，不需要任何账号，手机电脑都行。',
    steps: [
      '把要投稿的图片 / 视频挑出来（手机相册、微信聊天记录都行）',
      '附上日期、来源群、标签这三点信息，站长才能正确归档',
      `发过去：${SITE.contact}`,
      '站长会用入库工具处理：转码、抽封面、生成缩略图，然后按月份上线',
    ],
  },
  {
    badge: '开发中',
    title: '二、用 GitHub Issue 自助投稿',
    tone: 'accent2',
    available: false,
    summary: '用你自己的 GitHub 账号贴文件，不需要任何令牌，也不需要站长在线。',
    steps: [
      '需要一个 GitHub 账号（免费注册）',
      '在仓库里开一个投稿 Issue，把图片/视频拖进正文，填上日期和标签',
      '机器人自动处理并开一个待合并的请求，站长点一下合并就上线',
      '附件实测支持 29.5MB 以上的 mp4，绝大多数微信短视频都够',
    ],
  },
  {
    badge: '不推荐',
    title: '三、找站长要上传令牌，自己在 /admin 传',
    tone: 'muted',
    available: true,
    summary: '能用，但请先看完下面的风险说明再决定。',
    steps: [
      '站长给你一个 fine-grained token，你在 /admin 的上传页签填入',
      '之后可以自己拖文件、填元数据、直接入库',
      '⚠️ 这个令牌等于仓库的写入权限：能改前端代码、能删文件',
      '只在完全信任的前提下使用，并且用完请站长立刻吊销',
    ],
  },
];

const RULES = [
  '不要上传违法、涉黄、暴恐或侵犯他人隐私的内容——站点是公开的，出了事是站长的账号担责',
  '别人发在群里的内容不等于可以公开转载；涉及具体个人的画面请先打码或征得同意',
  '截图里的群名、昵称、头像、二维码、手机号都会跟着一起公开，投稿前自己先看一眼',
  '所有图片在入库时会重新编码，EXIF（含 GPS 定位、设备型号）会被剥离',
];

const TIPS = [
  '视频尽量短：单文件控制在 30MB 以内最稳，两边都省事',
  '竖屏视频完全没问题，站点按原始比例展示，不会裁切',
  '动图（GIF）会保留动画，封面取第一帧',
  '同一个文件重复投稿不会重复收录——入库时按内容哈希查重',
  '画质不必自己压：入库会统一转成 H.264、长边 1280，压得太狠反而更糊',
];

const FAQ: Array<[string, string]> = [
  [
    '日期填错了 / 没填会怎样？',
    '日期决定这条内容归到哪个月。没填的话工具会依次尝试：图片 EXIF 拍摄时间 → 文件路径里的年月 → 视频容器时间 → 文件修改时间。后两者经常不准，所以最好主动告知。',
  ],
  [
    '投上去还能删掉吗？',
    '能。站长在管理页把这条标为「不可见」，站点和榜单上立刻消失，文件仍留在仓库历史里以便恢复。要彻底删除需要改写仓库历史，一般不做。',
  ],
  [
    '为什么我的视频传上去之后清晰度变了？',
    '入库会把视频统一转成 H.264 并限制长边 1280。微信里大量视频是 HEVC/H.265 编码，浏览器根本放不出来（黑屏），所以必须转码。',
  ],
  [
    '为什么不能自己注册一个账号直接传？',
    '这是个纯静态站，没有自己的服务器和数据库，所以没有"注册登录"这回事。可行方案要么是你在 GitHub 上用自己的账号投稿（方式二），要么是把文件交给站长（方式一）。',
  ],
];

export function Guide() {
  const [copied, setCopied] = useState(false);
  const access = useAccess();

  return (
    <div className="mx-auto max-w-4xl">
      <header className="pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">投稿指引</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-2">
          这个站收录 {SITE.tagline}，按月份归档。
          下面是投稿的三条路，以及投稿前该注意的事。
        </p>
      </header>

      <section className="space-y-3">
        {METHODS.map((method) => (
          <MethodCard key={method.title} method={method} />
        ))}
      </section>

      {/* 复制模板 */}
      <section className="mt-6 rounded-2xl border border-line bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-ink">投稿信息模板</h2>
            <p className="mt-0.5 text-[12px] text-ink-3">
              复制一下，连同文件一起发出去，站长就不用再回头问你信息了。
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(TEMPLATE).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              });
            }}
            className="shrink-0 rounded-xl bg-accent px-4 py-2 text-[13px] font-medium text-white shadow-sm shadow-accent/30 transition hover:bg-accent-bright"
          >
            {copied ? '已复制 ✓' : '复制模板'}
          </button>
        </div>
        <pre className="mt-3 overflow-x-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-[11px] leading-5 text-ink-2">
          {TEMPLATE}
        </pre>
      </section>

      {/* 须知与建议 */}
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <ListCard title="投稿须知（重要）" tone="like" items={RULES} />
        <ListCard title="素材建议" tone="accent2" items={TIPS} />
      </div>

      {/* FAQ */}
      <section className="mt-6">
        <h2 className="mb-3 text-base font-semibold text-ink">常见问题</h2>
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
          {FAQ.map(([question, answer]) => (
            <details key={question} className="group px-4 py-3">
              <summary className="cursor-pointer list-none text-[13px] font-medium text-ink marker:hidden">
                <span className="mr-2 text-accent transition group-open:rotate-90 inline-block">›</span>
                {question}
              </summary>
              <p className="mt-2 pl-5 text-[12px] leading-6 text-ink-2">{answer}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="mt-6 rounded-2xl border border-line bg-surface p-4 text-[12px] leading-6 text-ink-2 shadow-sm">
        {access.canEdit ? (
          <>
            你当前是<b>站长</b>身份，可以直接在{' '}
            <Link to="/admin" className="font-medium text-accent hover:underline">
              上传 / 管理
            </Link>{' '}
            页处理素材。这一页可以直接把链接发给群友。
          </>
        ) : access.canUpload ? (
          <>
            你当前是<b>贡献者</b>身份（有上传令牌），可以在{' '}
            <Link to="/admin" className="font-medium text-accent hover:underline">
              上传
            </Link>{' '}
            页自己传素材；修改已入库内容的权限仍然只属于站长。
          </>
        ) : (
          <>
            你当前是<b>访客</b>身份。上面「方式一」现在就能用；
            「方式二」做好之后，这里会出现直接的投稿入口。
          </>
        )}
      </footer>
    </div>
  );
}

function MethodCard({ method }: { method: Method }) {
  const tone =
    method.tone === 'accent'
      ? { bar: 'bg-accent', badge: 'bg-accent-soft text-accent-ink', dot: 'bg-accent' }
      : method.tone === 'accent2'
        ? { bar: 'bg-accent-2', badge: 'bg-accent-2-soft text-accent-2', dot: 'bg-accent-2' }
        : { bar: 'bg-line-strong', badge: 'bg-surface-2 text-ink-3', dot: 'bg-ink-3' };

  return (
    <article
      className={[
        'overflow-hidden rounded-2xl border bg-surface shadow-sm',
        method.available ? 'border-line' : 'border-dashed border-line-strong',
      ].join(' ')}
    >
      <header className="flex flex-wrap items-center gap-2.5 border-b border-line px-4 py-3">
        <span className={`h-4 w-1 rounded-full ${tone.bar}`} />
        <h2 className="text-[14px] font-semibold text-ink">{method.title}</h2>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tone.badge}`}>
          {method.badge}
        </span>
      </header>
      <div className="px-4 py-3">
        <p className="text-[12px] leading-5 text-ink-2">{method.summary}</p>
        <ul className="mt-2.5 space-y-1.5">
          {method.steps.map((stepLine) => (
            <li key={stepLine} className="flex gap-2 text-[12px] leading-5 text-ink-2">
              <span className={`mt-[7px] size-1 shrink-0 rounded-full ${tone.dot}`} />
              <span>{stepLine}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

function ListCard({
  title,
  tone,
  items,
}: {
  title: string;
  tone: 'like' | 'accent2';
  items: string[];
}) {
  const accent = tone === 'like' ? 'text-like' : 'text-accent-2';
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
      <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
      <ul className="mt-2.5 space-y-2">
        {items.map((item) => (
          <li key={item} className="flex gap-2 text-[12px] leading-5 text-ink-2">
            <span className={`mt-[3px] shrink-0 ${accent}`}>·</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
