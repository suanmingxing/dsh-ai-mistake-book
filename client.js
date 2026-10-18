/**
 * AI 错题本 — client half.
 *
 * Three pages: 待归档 (review drafts against the original scan, then confirm the
 * archive), 已归档 (browse by knowledge point and search), 设置 (edit the prompt
 * templates and read the effective parameters).
 *
 * Plain ESM, no JSX, no build step: React comes from the browser module table.
 * Only `--dsw-alias-*` theme tokens are used for colour, so light/dark switching
 * is inherited rather than re-implemented.
 */
window.__ModuleLoader__.load({
  id: 'ai-mistake-book',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'aiMistakeBook'

    const ZH = {
      nav: 'AI 错题本',
      tabPending: '待归档',
      tabLibrary: '已归档',
      libraryBrowse: '浏览',
      libraryManage: '管理',
      manageIntro: '这里管理**已归档**的内容：删除卡片、还原或清空回收站、导出 PDF。删除的卡片先进入回收站，可随时还原；只有「清空回收站」会真正销毁数据。',
      tabSettings: '设置',
      manageHint: '勾选要删除的卡片后确认。删除的卡片会进回收站，可随时恢复；只有「清空回收站」会真正销毁数据。',
      selectAll: '全选',
      clearSelection: '清除选择',
      selectedCount: '已选 {n} 张卡片',
      deleteSelected: '删除所选',
      confirmDelete: '确认删除',
      cancel: '取消',
      working: '处理中…',
      noCards: '库里还没有卡片。',
      noMatch: '没有匹配的卡片。',
      questionShort: '第 ',
      deletedNote: '已删除 {n} 张卡片。',
      deletedPapersNote: '另有 {n} 份卷子（含扫描件）一并移除。',
      skippedNote: '有 {n} 项未找到，已跳过。',
      deleteToTrashNote: '将移入回收站，可恢复。',
      deletePermanentNote: '设置里已关闭回收站：删除立即生效且不可恢复。',
      includePapers: '这些卷子已经没有卡片了，连扫描件一起删除（{n} 份）',
      bin: '回收站',
      binEmpty: '回收站是空的。',
      binItems: '{n} 项',
      binAge: '（{n} 天前）',
      binStale: '超过 {n} 天保留期，可清理',
      restoreAll: '全部恢复',
      restorePicked: '恢复所选',
      selectAllInBin: '全选本批',
      emptyBin: '清空',
      emptyAllBins: '清空回收站',
      binEmptiedNote: '回收站已清空，其中的文件已永久删除。',
      restoredNote: '已恢复 {n} 项。',
      conflictNote: '有 {n} 项因原位置已存在同名文件而跳过。',
      exportTitle: '导出为 PDF',
      exportSelected: '导出所选',
      exportAll: '导出全部',
      exportHint: '生成一份可打印的错题集，含题干、作答、错因和原卷切片；公式以 Unicode 形式排版（不是 MathType）。文件写入归档根目录的 exports/。',
      optAnswers: '含作答与解法',
      optUncertain: '含待确认项',
      exportDefaults: '导出 PDF 的默认板块',
      exportDefaultsHint: '每道错题在 PDF 里包含哪些板块。「管理」页导出时还能临时改这一次的勾选。',
      exportDefaultsSaved: '已保存导出默认板块',
      openSession: '打开分析会话',
      customTemplates: '我的自定义模板',
      customTemplatesHint: '这里新增的条目会按顺序并入分析任务书的「用户自定义要求」一节，下次分析自动生效；停用后不并入。',
      customTemplatesEmpty: '还没有自定义模板。',
      customTitle: '模板标题（如：保留分数线层级）',
      customDescription: '说明（这条规则想解决什么；会一并写进提示词）',
      customContent: '正文（Markdown，原样并入任务书）',
      customEditing: '正在编辑已有模板',
      editTemplate: '编辑',
      deleteTemplate: '删除',
      customSaved: '已保存自定义模板',
      customDeleted: '已删除该模板',
      optSource: '含原卷图片',
      optCrop: '原卷只保留题目所在高度',
      exportedNote: '已导出 {n} 张卡片（{p} 份卷子）。',
      openPdf: '打开 PDF',
      pastExports: '历史导出',
      exportManage: '导出管理',
      exportManageHint: '导出文件写在归档根的 exports/ 下。删除会先移入回收站，可在下方回收站里还原。',
      exportEmpty: '还没有导出文件。',
      exportMeta: '{cards} 张卡片 · {papers} 份卷子',
      exportMetaUnknown: '（旧导出，无元信息）',
      exportCopyPath: '复制路径',
      exportPathCopied: '已复制文件路径',
      exportPath: '文件路径',
      exportDeleted: '已移入回收站:{name}',
      missingFonts: '缺少字体：{n}',
      refresh: '刷新',
      expand: '展开',
      collapse: '收起',
      loading: '读取中…',
      emptyPending: '没有待确认的批次。请在「AI 错题本」工作区的会话里用 /mistake 附上扫描件，或直接给出文件绝对路径。',
      introPending: '分析在你发出命令的那个会话里进行；分析期间该会话的工具会被临时收窄，结束或停止后自动恢复。',
      emptyLibrary: '档案还是空的。确认归档后卡片会出现在这里。',
      archiveRoot: '归档目录',
      parameters: '参数',
      pages: '页',
      drafts: '草稿',
      candidates: '候选',
      recuts: '次重切',
      session: '分析会话',
      hint: '提示',
      status: '状态',
      confirmArchive: '确认归档',
      archivedOk: '已归档',
      dropDraft: '删除草稿',
      save: '保存',
      saved: '已保存',
      original: '原图（卡片指向的区域）',
      noOriginal: '这张卡片没有可回溯的原图切片',
      knowledgePoints: '知识点（多级用 /，多条用 ；）',
      errorTypes: '错因（多条用 ；）',
      questionRef: '题号',
      difficulty: '难度',
      body: '卡片正文（Markdown，公式用 $...$）',
      preview: '预览（公式已渲染）',
      renderFailed: '渲染失败',
      mathUnavailable: '公式渲染不可用',
      uncertainty: '这张卡片有「待人工确认」项，归档前请核对',
      search: '搜索题号、知识点、错因、卷名…',
      cards: '张',
      points: '个知识点',
      papers: '份卷子',
      template: '模板',
      templateSaved: '模板已保存',
      failed: '读取失败',
      totals: '合计',
      reindex: '重建索引',
      statusArchived: '已归档',
      statusAwaiting: '待确认',
      statusAnalyzing: '分析中',
      statusStaged: '已提取',
      statusEnded: '分析已结束（未提取）',
      statusCancelled: '已停止',
      statusFailed: '失败',
      statusIngesting: '摄取中',
      statusRasterized: '已切片',
    }

    const EN = {
      nav: 'AI Mistake Book',
      tabPending: 'To review',
      tabLibrary: 'Archive',
      libraryBrowse: 'Browse',
      libraryManage: 'Manage',
      manageIntro: 'Everything here acts on **archived** material: removing cards, restoring or emptying the recycle bin, and exporting PDFs. Deletions go to the recycle bin first; only emptying it destroys data.',
      tabSettings: 'Settings',
      manageHint: 'Tick the cards to remove, then confirm. They go to the recycle bin and can be restored; only emptying the bin destroys data.',
      selectAll: 'Select all',
      clearSelection: 'Clear',
      selectedCount: '{n} card(s) selected',
      deleteSelected: 'Delete selected',
      confirmDelete: 'Confirm delete',
      cancel: 'Cancel',
      working: 'Working…',
      noCards: 'The library has no cards yet.',
      noMatch: 'No card matches.',
      questionShort: 'Q',
      deletedNote: 'Deleted {n} card(s).',
      deletedPapersNote: '{n} paper folder(s), scans included, were removed too.',
      skippedNote: '{n} item(s) were not found and were skipped.',
      deleteToTrashNote: 'They move to the recycle bin and can be restored.',
      deletePermanentNote: 'The recycle bin is off in Settings: deletion is immediate and final.',
      includePapers: 'These papers have no cards left — delete their scans too ({n})',
      bin: 'Recycle bin',
      binEmpty: 'The recycle bin is empty.',
      binItems: '{n} item(s)',
      binAge: '({n} day(s) ago)',
      binStale: 'Past the {n}-day retention — safe to empty',
      restoreAll: 'Restore all',
      restorePicked: 'Restore selected',
      selectAllInBin: 'Select all in this batch',
      emptyBin: 'Empty',
      emptyAllBins: 'Empty bin',
      binEmptiedNote: 'The recycle bin was emptied; those files are gone for good.',
      restoredNote: 'Restored {n} item(s).',
      conflictNote: '{n} item(s) were skipped because a file already exists at the original path.',
      exportTitle: 'Export to PDF',
      exportSelected: 'Export selected',
      exportAll: 'Export all',
      exportHint: 'Builds a printable mistake booklet with the stem, the answer, the error type and a crop of the original scan. Formulas are transliterated to Unicode, not typeset. Files go to exports/ under the archive root.',
      optAnswers: 'Include answers',
      optUncertain: 'Include to-confirm notes',
      exportDefaults: 'Default PDF sections',
      exportDefaultsHint: 'Which card sections each question shows in the PDF. The Manage tab can override them for a single export.',
      exportDefaultsSaved: 'Default PDF sections saved',
      openSession: 'Open the analysis session',
      customTemplates: 'My prompt templates',
      customTemplatesHint: 'Entries are appended to the analysis brief under “用户自定义要求” and take effect on the next analysis; disabled entries are skipped.',
      customTemplatesEmpty: 'No custom templates yet.',
      customTitle: 'Title (e.g. keep fraction levels)',
      customDescription: 'Description (what this rule is for; it is written into the prompt too)',
      customContent: 'Body (Markdown, merged into the brief verbatim)',
      customEditing: 'Editing an existing template',
      editTemplate: 'Edit',
      deleteTemplate: 'Delete',
      customSaved: 'Custom template saved',
      customDeleted: 'Template deleted',
      optSource: 'Include the scan image',
      optCrop: 'Show only the question\'s height of the scan',
      exportedNote: 'Exported {n} card(s) from {p} paper(s).',
      openPdf: 'Open the PDF',
      pastExports: 'Earlier exports',
      exportManage: 'Export management',
      exportManageHint: 'Exports live in exports/ under the archive root. Deleting moves them to the recycle bin below, where they can be restored.',
      exportEmpty: 'No exports yet.',
      exportMeta: '{cards} card(s) · {papers} paper(s)',
      exportMetaUnknown: '(older export, no metadata)',
      exportCopyPath: 'Copy path',
      exportPathCopied: 'File path copied',
      exportPath: 'File path',
      exportDeleted: 'Moved to the recycle bin: {name}',
      missingFonts: 'Missing fonts: {n}',
      refresh: 'Refresh',
      expand: 'Open',
      collapse: 'Close',
      loading: 'Loading…',
      emptyPending: 'Nothing waiting. In a session inside the AI Mistake Book workspace, run /mistake with a scan — or just give the file path.',
      introPending: 'The analysis runs in the session that issued the command; that session\'s tools are narrowed while it runs and restored afterwards.',
      emptyLibrary: 'The archive is empty. Cards appear here once archived.',
      archiveRoot: 'Archive root',
      parameters: 'Parameters',
      pages: 'pages',
      drafts: 'drafts',
      candidates: 'candidates',
      recuts: 're-cuts',
      session: 'Session',
      hint: 'Hint',
      status: 'Status',
      confirmArchive: 'Confirm and archive',
      archivedOk: 'Archived',
      dropDraft: 'Delete draft',
      save: 'Save',
      saved: 'Saved',
      original: 'Original (the region this card points at)',
      noOriginal: 'No source crop is reachable for this card',
      knowledgePoints: 'Knowledge points (levels with /, several with ;)',
      errorTypes: 'Error types (several with ;)',
      questionRef: 'Question',
      difficulty: 'Difficulty',
      body: 'Card body (Markdown, formulas as $...$)',
      preview: 'Preview (math rendered)',
      renderFailed: 'Render failed',
      mathUnavailable: 'Math rendering unavailable',
      uncertainty: 'This card has unresolved items — check before archiving',
      search: 'Search question, knowledge point, error type, paper…',
      cards: 'cards',
      points: 'knowledge points',
      papers: 'papers',
      template: 'Template',
      templateSaved: 'Template saved',
      failed: 'Failed to load',
      totals: 'Totals',
      reindex: 'Rebuild index',
      statusArchived: 'Archived',
      statusAwaiting: 'Needs review',
      statusAnalyzing: 'Analysing',
      statusStaged: 'Extracted',
      statusEnded: 'Analysis ended (nothing extracted)',
      statusCancelled: 'Stopped',
      statusFailed: 'Failed',
      statusIngesting: 'Ingesting',
      statusRasterized: 'Rasterised',
    }

    async function api(method, payload) {
      const response = await fetch(`/mistake/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || data === null || data.ok !== true) {
        const message = data?.error?.message ?? `HTTP ${response.status}`
        // 宿主没加载到新代码时，接口会回 "未知的接口方法"：那说明插件被改过但进程没重启，
        // 直接把原因写在错误里，省得去猜是不是功能写坏了。
        throw new Error(message.includes('未知的接口方法')
          ? `${message}（宿主仍在运行旧版插件代码，重启 DeepSeek Harness 后生效）`
          : message)
      }
      return data.value
    }

    const token = (name) => `var(${name})`
    const styles = {
      root: { display: 'flex', flexDirection: 'column', gap: '12px', width: '100%', boxSizing: 'border-box', fontSize: '13px', color: token('--dsw-alias-label-primary') },
      row: { display: 'flex', alignItems: 'center', gap: '10px', justifyContent: 'space-between' },
      wrap: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      card: {
        border: `1px solid ${token('--dsw-alias-border-l1')}`,
        borderRadius: '8px',
        background: token('--dsw-alias-bg-layer-1'),
        padding: '12px 14px',
      },
      muted: { color: token('--dsw-alias-label-secondary') },
      small: { fontSize: '12px', color: token('--dsw-alias-label-secondary') },
      button: {
        border: `1px solid ${token('--dsw-alias-border-l2')}`,
        background: token('--dsw-alias-bg-layer-2'),
        color: token('--dsw-alias-label-primary'),
        borderRadius: '6px',
        padding: '4px 10px',
        cursor: 'pointer',
        fontSize: '12px',
      },
      primary: {
        border: `1px solid ${token('--dsw-alias-brand-primary')}`,
        background: token('--dsw-alias-brand-primary'),
        color: token('--dsw-alias-bg-base'),
        borderRadius: '6px',
        padding: '5px 12px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: 600,
      },
      // 选中态：整块填充品牌色 + 反色文字 + 加粗。
      // 原来只有 `borderColor`（1px，从 10% 黑换成近黑），在浅/深主题下都几乎看不出差别，
      // “切到另一个后旧的高亮消失”也就没有可感知的效果；而且用长属性覆盖 `border` 简写，
      // 依赖浏览器对属主声明的处理，属于最容易出岔子的写法。改成整套覆盖后，
      // 选中/未选中一眼可分，切换时旧按钮会完整回到 styles.button。
      active: {
        border: `1px solid ${token('--dsw-alias-brand-primary')}`,
        background: token('--dsw-alias-brand-primary'),
        color: token('--dsw-alias-bg-base'),
        fontWeight: 600,
      },
      tab: (on) => ({
        border: 'none',
        borderBottom: `2px solid ${on ? token('--dsw-alias-brand-primary') : 'transparent'}`,
        background: 'transparent',
        color: on ? token('--dsw-alias-label-primary') : token('--dsw-alias-label-secondary'),
        padding: '6px 2px',
        marginRight: '14px',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: on ? 600 : 400,
      }),
      chip: {
        display: 'inline-block',
        borderRadius: '999px',
        padding: '1px 8px',
        fontSize: '11px',
        border: `1px solid ${token('--dsw-alias-border-l1')}`,
        color: token('--dsw-alias-label-secondary'),
      },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${token('--dsw-alias-border-l1')}`,
        borderRadius: '6px',
        background: token('--dsw-alias-bg-layer-2'),
        color: token('--dsw-alias-label-primary'),
        padding: '5px 8px',
        fontSize: '12px',
        fontFamily: 'inherit',
      },
      textarea: {
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${token('--dsw-alias-border-l1')}`,
        borderRadius: '6px',
        background: token('--dsw-alias-bg-layer-2'),
        color: token('--dsw-alias-label-primary'),
        padding: '8px',
        fontSize: '12px',
        fontFamily: 'ui-monospace, Consolas, monospace',
        lineHeight: 1.55,
        resize: 'vertical',
      },
      error: { color: token('--dsw-alias-state-error-primary') },
      warn: { color: token('--dsw-alias-state-warn-primary') },
      ok: { color: token('--dsw-alias-state-success-primary') },
      pre: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12px', lineHeight: 1.6, margin: 0, fontFamily: 'inherit' },
      split: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', alignItems: 'start' },
      img: { width: '100%', height: 'auto', borderRadius: '6px', border: `1px solid ${token('--dsw-alias-border-l1')}`, background: '#ffffff' },
      label: { display: 'block', marginBottom: '4px', fontSize: '12px', color: token('--dsw-alias-label-secondary') },
      field: { marginBottom: '10px' },
      clickable: { cursor: 'pointer' },
      /** One row inside a list of batches, cards or recycle-bin folders. */
      batchRow: { padding: '8px 0', borderTop: `1px solid ${token('--dsw-alias-border-l1')}` },
      /** Reserved for destructive actions, so deleting never looks like a normal button. */
      danger: {
        border: `1px solid ${token('--dsw-alias-state-error-primary')}`,
        background: 'transparent',
        color: token('--dsw-alias-state-error-primary'),
        borderRadius: '6px',
        padding: '4px 10px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: '500',
      },
    }

    const STATUS_LABEL = {
      ingesting: 'statusIngesting',
      rasterized: 'statusRasterized',
      analyzing: 'statusAnalyzing',
      staged: 'statusStaged',
      'awaiting-confirmation': 'statusAwaiting',
      'analysis-ended': 'statusEnded',
      archived: 'statusArchived',
      cancelled: 'statusCancelled',
      failed: 'statusFailed',
    }

    function statusStyle(status) {
      if (status === 'failed') return styles.error
      if (status === 'awaiting-confirmation' || status === 'staged') return styles.warn
      if (status === 'archived') return styles.ok
      return styles.muted
    }

    const splitList = (text) => String(text ?? '').split(/[;；,，]/).map((part) => part.trim()).filter((part) => part !== '')
    const cropUrl = (file, cell) => `/mistake/crop?file=${encodeURIComponent(file)}${Number.isFinite(cell) ? `&cell=${cell}` : ''}`

    function Field(props) {
      return h('div', { style: styles.field }, h('label', { style: styles.label }, props.label), props.children)
    }

    /**
     * A crashing component must not present as a blank page. DSH renders each slot
     * entry on its own, so catching here turns "nothing shows up" into a readable
     * error inside the panel — the difference between a bug report and a diagnosis.
     */
    class Boundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { error: null }
      }

      static getDerivedStateFromError(error) {
        return { error }
      }

      componentDidCatch(error, info) {
        if (typeof console !== 'undefined') console.error('ai-mistake-book: render failed', error, info)
      }

      render() {
        if (this.state.error !== null) {
          const error = this.state.error
          return h('div', { style: { ...styles.card, ...styles.error } },
            h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, 'AI 错题本渲染出错（请把下面这段发给开发者）'),
            h('pre', { style: styles.pre }, String(error?.stack ?? error?.message ?? error)),
          )
        }
        return this.props.children
      }
    }

    /** Counts arrive under several names across versions; never render "undefined". */
    const count = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

    /**
     * Scoped stylesheet for rendered card bodies, kept as a React element so it is
     * removed with the component and written against theme tokens only. KaTeX
     * contributes MathML, which needs no stylesheet of its own.
     */
    const PROSE_CSS = [
      '.aimb-prose{font-size:13px;line-height:1.75;word-break:break-word}',
      '.aimb-prose h1{font-size:16px;margin:10px 0 6px;font-weight:600}',
      '.aimb-prose h2{font-size:14px;margin:14px 0 6px;font-weight:600}',
      '.aimb-prose h3,.aimb-prose h4,.aimb-prose h5,.aimb-prose h6{font-size:13px;margin:12px 0 4px;font-weight:600}',
      '.aimb-prose p{margin:0 0 8px}',
      '.aimb-prose ul,.aimb-prose ol{margin:0 0 8px;padding-left:22px}',
      '.aimb-prose li{margin:2px 0}',
      '.aimb-prose blockquote{margin:0 0 8px;padding:2px 10px;border-left:3px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.aimb-prose code{font-family:ui-monospace,Consolas,monospace;font-size:12px;background:var(--dsw-alias-bg-layer-2);padding:1px 4px;border-radius:4px}',
      '.aimb-prose pre{margin:0 0 8px;padding:8px;border-radius:6px;background:var(--dsw-alias-bg-layer-2);overflow:auto}',
      '.aimb-prose pre code{background:transparent;padding:0}',
      '.aimb-prose hr{border:none;border-top:1px solid var(--dsw-alias-border-l1);margin:12px 0}',
      '.aimb-prose a{color:var(--dsw-alias-brand-primary)}',
      '.aimb-prose math{font-size:1.06em}',
      '.aimb-prose math[display="block"]{display:block;margin:8px 0}',
    ].join('\n')

    /**
     * Render Markdown + LaTeX on the Host, then show the finished HTML. The Host
     * owns escaping, so the only unescaped markup here is what KaTeX produced.
     */
    function Prose(props) {
      const t = props.t
      const [state, setState] = React.useState({ html: null, error: null, mathError: null })
      React.useEffect(() => {
        let alive = true
        api('render', { markdown: props.markdown })
          .then((value) => {
            if (alive) setState({ html: value.html, error: null, mathError: value.mathAvailable ? null : value.mathError })
          })
          .catch((error) => {
            if (alive) setState({ html: null, error: error.message, mathError: null })
          })
        return () => { alive = false }
      }, [props.markdown])

      if (state.error !== null) return h('div', { style: styles.error }, `${t('renderFailed')}: ${state.error}`)
      if (state.html === null) return h('div', { style: styles.muted }, t('loading'))
      return h('div', null,
        h('style', null, PROSE_CSS),
        state.mathError === null ? null : h('div', { style: { ...styles.small, ...styles.warn } }, `${t('mathUnavailable')}: ${state.mathError}`),
        h('div', { className: 'aimb-prose', dangerouslySetInnerHTML: { __html: state.html } }),
      )
    }

    function SourcePane(props) {
      const { sourceImage, cell, t } = props
      if (!sourceImage) return h('div', { style: { ...styles.card, ...styles.muted } }, t('noOriginal'))
      return h('div', { style: styles.card },
        h('div', { style: styles.label }, t('original')),
        h('img', { style: styles.img, src: cropUrl(sourceImage, cell), alt: 'source' }),
        h('div', { style: { ...styles.small, marginTop: '6px' } }, sourceImage),
      )
    }

    function DraftEditor(props) {
      const { batchId, draft, t, onChanged } = props
      const [fields, setFields] = React.useState(draft.fields)
      const [body, setBody] = React.useState(draft.body)
      const [note, setNote] = React.useState(null)
      const [busy, setBusy] = React.useState(false)

      React.useEffect(() => {
        setFields(draft.fields)
        setBody(draft.body)
        setNote(null)
      }, [draft.fileName, draft.markdown])

      const save = () => {
        setBusy(true)
        api('draftUpdate', {
          batchId,
          fileName: draft.fileName,
          frontMatter: {
            questionRef: fields.questionRef,
            knowledgePoints: splitList(fields.knowledgePointsText ?? (fields.knowledgePoints ?? []).join('；')),
            errorTypes: splitList(fields.errorTypesText ?? (fields.errorTypes ?? []).join('；')),
            difficulty: fields.difficulty,
          },
          body,
        })
          .then(() => { setNote({ kind: 'ok', text: t('saved') }); onChanged() })
          .catch((error) => setNote({ kind: 'error', text: error.message }))
          .finally(() => setBusy(false))
      }

      const drop = () => {
        setBusy(true)
        api('draftDrop', { batchId, fileName: draft.fileName })
          .then(() => onChanged())
          .catch((error) => setNote({ kind: 'error', text: error.message }))
          .finally(() => setBusy(false))
      }

      const cell = Number(draft.fields.source?.cell)
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        draft.hasUncertainty ? h('div', { style: { ...styles.card, ...styles.warn } }, t('uncertainty')) : null,
        h('div', { style: styles.split },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
            h(SourcePane, { sourceImage: draft.sourceImage, cell: Number.isFinite(cell) ? cell : undefined, t }),
            h('div', { style: { ...styles.card, ...styles.small } },
              `${draft.fields.id}　${draft.fields.paper}　${draft.fields.verdict}　${draft.fileName}`),
          ),
          h('div', { style: styles.card },
            h(Field, { label: t('questionRef') },
              h('input', {
                style: styles.input,
                value: fields.questionRef ?? '',
                onChange: (event) => setFields({ ...fields, questionRef: event.target.value }),
              })),
            h(Field, { label: t('knowledgePoints') },
              h('input', {
                style: styles.input,
                value: fields.knowledgePointsText ?? (fields.knowledgePoints ?? []).join('；'),
                onChange: (event) => setFields({ ...fields, knowledgePointsText: event.target.value }),
              })),
            h(Field, { label: t('errorTypes') },
              h('input', {
                style: styles.input,
                value: fields.errorTypesText ?? (fields.errorTypes ?? []).join('；'),
                onChange: (event) => setFields({ ...fields, errorTypesText: event.target.value }),
              })),
            h(Field, { label: t('difficulty') },
              h('select', {
                style: styles.input,
                value: fields.difficulty ?? '中',
                onChange: (event) => setFields({ ...fields, difficulty: event.target.value }),
              }, ['易', '中', '难'].map((value) => h('option', { key: value, value }, value)))),
            h(Field, { label: t('body') },
              h('textarea', {
                style: { ...styles.textarea, minHeight: '300px' },
                value: body,
                onChange: (event) => setBody(event.target.value),
              })),
            h('div', { style: styles.field },
              h('div', { style: styles.label }, t('preview')),
              h('div', { style: styles.card }, h(Prose, { markdown: body, t })),
            ),
            h('div', { style: styles.wrap },
              h('button', { style: styles.button, onClick: save, disabled: busy }, t('save')),
              h('button', { style: styles.button, onClick: drop, disabled: busy }, t('dropDraft')),
              note === null ? null : h('span', { style: note.kind === 'ok' ? styles.ok : styles.error }, note.text),
            ),
          ),
        ),
      )
    }

    function BatchBlock(props) {
      const { batch, t, onChanged, openSession } = props
      const [open, setOpen] = React.useState(false)
      const [detail, setDetail] = React.useState(null)
      const [selected, setSelected] = React.useState(null)
      const [note, setNote] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      // 用户是否已经自己点过卡片。没点过时首次展开默认选中第一张；
      // 点过之后（尤其是主动取消选择）就不许 load() 再自动帮他选回去。
      const userPicked = React.useRef(false)

      const load = React.useCallback(() => {
        api('batch', { batchId: batch.id })
          .then((value) => {
            setDetail(value)
            setSelected((current) => {
              if (current !== null && value.drafts.some((draft) => draft.fileName === current)) return current
              // 用户主动取消过 → 保持"不预览任何一张"，不要被下一次 load() 选回去
              if (userPicked.current) return null
              return value.drafts.length > 0 ? value.drafts[0].fileName : null
            })
          })
          .catch((error) => setNote({ kind: 'error', text: error.message }))
      }, [batch.id])

      React.useEffect(() => { if (open) load() }, [open, load])

      const archive = () => {
        setBusy(true)
        api('archive', { batchId: batch.id })
          .then((value) => { setNote({ kind: 'ok', text: `${t('archivedOk')} → ${value.paper.dir}` }); onChanged() })
          .catch((error) => setNote({ kind: 'error', text: error.message }))
          .finally(() => setBusy(false))
      }

      const drafts = detail === null ? [] : detail.drafts
      const current = selected === null ? null : drafts.find((draft) => draft.fileName === selected)

      return h('div', { style: styles.card },
        h('div', { style: styles.row },
          h('div', null,
            h('div', { style: { fontWeight: 600 } }, `${batch.id}　${batch.paperTitle ?? ''}`),
            h('div', { style: styles.small },
              `${count(batch.pageCount)} ${t('pages')} · ${count(batch.draftCount ?? batch.drafts)} ${t('drafts')} · ${count(batch.candidateCount ?? batch.candidates)} ${t('candidates')} · ${count(batch.recuts)} ${t('recuts')}`),
            batch.sessionTitle ? h('div', { style: styles.small }, batch.sessionTitle) : null,
            batch.hint ? h('div', { style: styles.small }, `${t('hint')}: ${batch.hint}`) : null,
          ),
          h('div', { style: styles.wrap },
            h('span', { style: { ...styles.chip, ...statusStyle(batch.status) } }, t(STATUS_LABEL[batch.status] ?? 'status')),
            batch.sessionId ? h('button', {
              style: styles.button,
              onClick: () => {
                setNote(null)
                Promise.resolve()
                  .then(() => openSession(batch.sessionId))
                  .catch((error) => setNote({ kind: 'error', text: error.message ?? String(error) }))
              },
            }, t('openSession')) : null,
            h('button', { style: styles.button, onClick: () => setOpen(!open) }, open ? t('collapse') : t('expand')),
          ),
        ),
        note === null ? null : h('div', { style: { marginTop: '6px', ...(note.kind === 'ok' ? styles.ok : styles.error), fontSize: '12px' } }, note.text),
        open ? h('div', { style: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '10px' } },
          detail === null ? h('div', { style: styles.muted }, t('loading')) : null,
          detail !== null && drafts.length > 0 ? h('div', { style: styles.wrap },
            drafts.map((draft) => h('button', {
              key: draft.fileName,
              style: { ...styles.button, ...(draft.fileName === selected ? styles.active : {}) },
              // 再点一次已选中的卡片 → 取消选择(回到"不预览任何一张")。
              // 原来是无条件 setSelected(draft.fileName)，再点同一张等于没反应。
              onClick: () => {
                userPicked.current = true
                setSelected((previous) => (previous === draft.fileName ? null : draft.fileName))
              },
            }, `${draft.fields.id}　${draft.fields.questionRef}${draft.hasUncertainty ? ' ⚠️' : ''}`)),
          ) : null,
          current === null ? null : h(DraftEditor, { batchId: batch.id, draft: current, t, onChanged: load }),
          detail !== null && drafts.length > 0 ? h('div', { style: styles.wrap },
            h('button', { style: styles.primary, onClick: archive, disabled: busy }, t('confirmArchive')),
          ) : null,
        ) : null,
      )
    }

    function PendingTab(props) {
      const { t, openSession } = props
      const [state, setState] = React.useState({ loading: true, error: null, status: null, batches: [] })

      const load = React.useCallback(() => {
        setState((current) => ({ ...current, loading: true, error: null }))
        Promise.all([api('status'), api('batches')])
          .then(([status, batches]) => setState({
            loading: false,
            error: null,
            status,
            batches: batches.batches.filter((batch) => batch.status !== 'archived'),
          }))
          .catch((error) => setState({ loading: false, error: error.message ?? String(error), status: null, batches: [] }))
      }, [])

      React.useEffect(load, [load])

      return h('div', { style: styles.root },
        h('div', { style: styles.row },
          state.status === null ? null : h('div', { style: styles.small }, `${t('archiveRoot')}: ${state.status.archiveRoot}`),
          h('button', { style: styles.button, onClick: load, disabled: state.loading }, t('refresh')),
        ),
        state.error === null ? null : h('div', { style: { ...styles.card, ...styles.error } }, `${t('failed')}: ${state.error}`),
        state.batches.length === 0 ? null : h('div', { style: styles.small }, t('introPending')),
        state.loading && state.batches.length === 0 ? h('div', { style: { ...styles.card, ...styles.muted } }, t('loading')) : null,
        !state.loading && state.batches.length === 0 ? h('div', { style: { ...styles.card, ...styles.muted } }, t('emptyPending')) : null,
        state.batches.map((batch) => h(BatchBlock, { key: batch.id, batch, t, onChanged: load, openSession })),
      )
    }

    function LibraryTab(props) {
      const { t } = props
      const [state, setState] = React.useState({ loading: true, error: null, index: null, detail: null, query: '' })

      const load = React.useCallback(() => {
        setState((current) => ({ ...current, loading: true, error: null }))
        api('library')
          .then((value) => setState((current) => ({ ...current, loading: false, index: value.index })))
          .catch((error) => setState((current) => ({ ...current, loading: false, error: error.message })))
      }, [])

      React.useEffect(load, [load])

      const open = (file) => {
        api('card', { file })
          .then((value) => setState((current) => ({ ...current, detail: value })))
          .catch((error) => setState((current) => ({ ...current, error: error.message })))
      }

      const index = state.index
      const query = state.query.trim().toLowerCase()
      const matches = index === null ? [] : index.cards.filter((entry) => query === ''
        || entry.id.toLowerCase().includes(query)
        || String(entry.questionRef).toLowerCase().includes(query)
        || entry.paper.toLowerCase().includes(query)
        || entry.knowledgePoints.join(' ').toLowerCase().includes(query)
        || entry.errorTypes.join(' ').toLowerCase().includes(query))

      const list = query === '' ? (index?.cards ?? []) : matches

      return h('div', { style: styles.root },
        h('div', { style: styles.row },
          index === null ? null : h('div', { style: styles.small },
            `${t('totals')}: ${index.totals.cards} ${t('cards')} · ${index.totals.knowledgePoints} ${t('points')} · ${index.totals.papers} ${t('papers')}`),
          h('div', { style: styles.wrap },
            h('button', {
              style: styles.button,
              onClick: () => api('reindex', {}).then((value) => setState((current) => ({ ...current, index: value.index }))),
            }, t('reindex')),
            h('button', { style: styles.button, onClick: load, disabled: state.loading }, t('refresh')),
          ),
        ),
        state.error === null ? null : h('div', { style: { ...styles.card, ...styles.error } }, state.error),
        index !== null && index.skipped.length > 0
          ? h('div', { style: { ...styles.card, ...styles.warn } }, `${index.skipped.length} 张卡片未能索引`)
          : null,
        h('input', {
          style: styles.input,
          placeholder: t('search'),
          value: state.query,
          onChange: (event) => setState((current) => ({ ...current, query: event.target.value })),
        }),
        h('div', { style: styles.split },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            (index?.subjects ?? []).map((subject) => h('div', { key: subject.subject, style: styles.card },
              h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, `${subject.subject}　${subject.cards} ${t('cards')}`),
              subject.tree.map((top) => h('div', { key: top.name, style: { marginBottom: '6px' } },
                h('div', { style: styles.small }, `▸ ${top.name}（${top.count}）`),
                top.points.map((point) => h('div', {
                  key: point.name,
                  style: { ...styles.small, marginLeft: '12px', ...styles.clickable },
                  onClick: () => setState((current) => ({ ...current, query: point.name })),
                }, `· ${point.name}（${point.count}）`)),
              )),
            )),
            index !== null && index.totals.cards === 0 ? h('div', { style: { ...styles.card, ...styles.muted } }, t('emptyLibrary')) : null,
          ),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            list.map((entry) => h('div', {
              key: entry.id,
              style: { ...styles.card, ...styles.clickable },
              onClick: () => open(entry.file),
            },
            h('div', { style: styles.row },
              h('div', { style: { fontWeight: 600 } }, `${entry.id}　${entry.questionRef === '' ? '' : `第 ${entry.questionRef} 题`}`),
              h('span', { style: styles.chip }, entry.difficulty),
            ),
            h('div', { style: styles.small }, entry.knowledgePoints.join('　｜　')),
            h('div', { style: styles.small }, `${entry.paper}　${entry.errorTypes.join('、')}${entry.hasUncertainty ? '　⚠️' : ''}`),
            )),
          ),
        ),
        state.detail === null ? null : h('div', { style: styles.split },
          h(SourcePane, {
            sourceImage: state.detail.sourceImage,
            cell: Number(state.detail.fields.source?.cell) || undefined,
            t,
          }),
          h('div', { style: styles.card }, h(Prose, { markdown: state.detail.markdown, t })),
        ),
      )
    }

    function SettingsTab(props) {
      const { t } = props
      const [state, setState] = React.useState({ loading: true, error: null, status: null, templates: null, dir: '', key: 'analysis', text: '', note: null, exportSettings: null, exportSections: [], custom: [] })
      const [customDraft, setCustomDraft] = React.useState({ id: null, title: '', description: '', content: '', enabled: true })

      const load = React.useCallback(() => {
        setState((current) => ({ ...current, loading: true, error: null }))
        Promise.all([api('status'), api('templates'), api('exportSettings', {})])
          .then(([status, templates, exportSettings]) => setState((current) => ({
            ...current,
            loading: false,
            status,
            templates: templates.templates,
            dir: templates.dir,
            text: templates.templates[current.key] ?? templates.templates.analysis ?? '',
            exportSettings: exportSettings.settings,
            exportSections: Array.isArray(exportSettings.sections) ? exportSettings.sections : [],
            custom: Array.isArray(templates.custom) ? templates.custom : [],
          })))
          .catch((error) => setState((current) => ({ ...current, loading: false, error: error.message })))
      }, [])

      React.useEffect(load, [load])

      const save = () => {
        api('templateSave', { key: state.key, content: state.text })
          .then(() => setState((current) => ({ ...current, note: t('templateSaved') })))
          .catch((error) => setState((current) => ({ ...current, note: error.message })))
      }

      const pick = (key) => setState((current) => ({ ...current, key, text: (current.templates ?? {})[key] ?? '', note: null }))

      const toggleDefaultSection = (key) => setState((current) => {
        const settings = current.exportSettings ?? { sections: {}, includeSource: true, cropToQuestion: true }
        return {
          ...current,
          note: null,
          exportSettings: { ...settings, sections: { ...settings.sections, [key]: settings.sections[key] === false } },
        }
      })

      const saveExportSettings = () => {
        const settings = state.exportSettings ?? { sections: {}, includeSource: true, cropToQuestion: true }
        api('exportSettingsSave', settings)
          .then((value) => setState((current) => ({ ...current, exportSettings: value.settings, note: t('exportDefaultsSaved') })))
          .catch((error) => setState((current) => ({ ...current, note: error.message })))
      }

      /* —— 用户自定义模板 —— */

      const resetCustomDraft = () => setCustomDraft({ id: null, title: '', description: '', content: '', enabled: true })

      const startCustomEdit = (item) => setCustomDraft({
        id: item.id,
        title: item.title,
        description: item.description,
        content: item.content,
        enabled: item.enabled !== false,
      })

      const saveCustom = () => {
        api('customTemplateSave', customDraft)
          .then((value) => {
            setState((current) => ({ ...current, custom: value.items, note: t('customSaved') }))
            resetCustomDraft()
          })
          .catch((error) => setState((current) => ({ ...current, note: error.message })))
      }

      const removeCustom = (item) => {
        api('customTemplateDelete', { id: item.id })
          .then((value) => {
            setState((current) => ({ ...current, custom: value.items, note: t('customDeleted') }))
            if (customDraft.id === item.id) resetCustomDraft()
          })
          .catch((error) => setState((current) => ({ ...current, note: error.message })))
      }

      const toggleCustomEnabled = (item) => {
        api('customTemplateSave', { ...item, enabled: item.enabled === false })
          .then((value) => setState((current) => ({ ...current, custom: value.items })))
          .catch((error) => setState((current) => ({ ...current, note: error.message })))
      }

      return h('div', { style: styles.root },
        state.error === null ? null : h('div', { style: { ...styles.card, ...styles.error } }, state.error),
        state.status === null ? null : h('div', { style: styles.card },
          h('div', { style: styles.label }, t('parameters')),
          h('pre', { style: styles.pre }, Object.entries(state.status).map(([key, value]) => `${key}: ${value}`).join('\n')),
        ),
        state.exportSections.length === 0 ? null : h('div', { style: styles.card },
          h('div', { style: styles.label }, t('exportDefaults')),
          h('div', { style: styles.small }, t('exportDefaultsHint')),
          h('div', { style: { ...styles.wrap, marginTop: '8px' } },
            state.exportSections.map((section) => h('label', {
              key: section.key,
              style: { display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '12px' },
            },
            h('input', {
              type: 'checkbox',
              checked: (state.exportSettings?.sections?.[section.key] ?? true) !== false,
              onChange: () => toggleDefaultSection(section.key),
            }),
            ` ${section.label}`)),
          ),
          h('div', { style: { ...styles.wrap, marginTop: '8px' } },
            h('button', { style: styles.primary, onClick: saveExportSettings }, t('save')),
            state.note === null ? null : h('span', { style: styles.ok }, state.note),
          ),
        ),
        h('div', { style: styles.card },
          h('div', { style: styles.label }, t('customTemplates')),
          h('div', { style: styles.small }, t('customTemplatesHint')),
          state.custom.length === 0
            ? h('div', { style: { ...styles.muted, marginTop: '6px' } }, t('customTemplatesEmpty'))
            : h('div', { style: { marginTop: '6px' } }, state.custom.map((item) => h('div', {
                key: item.id,
                style: { ...styles.row, alignItems: 'flex-start', marginTop: '6px' },
              },
              h('div', { style: { minWidth: '0', flex: '1 1 auto' } },
                h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
                  h('input', { type: 'checkbox', checked: item.enabled !== false, onChange: () => toggleCustomEnabled(item) }),
                  h('span', { style: { fontWeight: 600 } }, item.title),
                ),
                item.description === '' ? null : h('div', { style: styles.small }, item.description),
                item.content.trim() === '' ? null : h('div', { style: styles.muted }, item.content.split('\n')[0].slice(0, 80)),
              ),
              h('div', { style: styles.wrap },
                h('button', { style: styles.button, onClick: () => startCustomEdit(item) }, t('editTemplate')),
                h('button', { style: { ...styles.button, ...styles.danger }, onClick: () => removeCustom(item) }, t('deleteTemplate')),
              ),
            ))),
          h('div', { style: { marginTop: '10px' } },
            h('input', {
              style: styles.input,
              placeholder: t('customTitle'),
              value: customDraft.title,
              onChange: (event) => setCustomDraft((current) => ({ ...current, title: event.target.value })),
            }),
            h('input', {
              style: { ...styles.input, marginTop: '6px' },
              placeholder: t('customDescription'),
              value: customDraft.description,
              onChange: (event) => setCustomDraft((current) => ({ ...current, description: event.target.value })),
            }),
            h('textarea', {
              style: { ...styles.textarea, minHeight: '150px', marginTop: '6px' },
              placeholder: t('customContent'),
              value: customDraft.content,
              onChange: (event) => setCustomDraft((current) => ({ ...current, content: event.target.value })),
            }),
            h('div', { style: { ...styles.wrap, marginTop: '8px' } },
              h('button', { style: styles.primary, onClick: saveCustom, disabled: customDraft.title.trim() === '' }, t('save')),
              customDraft.id === null ? null : h('button', { style: styles.button, onClick: resetCustomDraft }, t('cancel')),
              customDraft.id === null ? null : h('span', { style: styles.small }, t('customEditing')),
              state.note === null ? null : h('span', { style: styles.ok }, state.note),
            ),
          ),
        ),
        state.templates === null
          ? h('div', { style: { ...styles.card, ...styles.muted } }, t('loading'))
          : h('div', { style: styles.card },
              h('div', { style: styles.label }, `${t('template')}　${state.dir}`),
              h('div', { style: styles.wrap },
                // 防御旧宿主：旧版接口会把自定义模板数组混进 templates，多出一个
                // 名叫 custom 的按钮，点它保存必然报「未知模板」。新版宿主已把
                // custom 拆出去，这里再滤一次，热载后即使宿主没重启也不显示坏按钮。
                Object.keys(state.templates).filter((key) => key !== 'custom').map((key) => h('button', {
                  key,
                  style: { ...styles.button, ...(key === state.key ? styles.active : {}) },
                  onClick: () => pick(key),
                }, key)),
              ),
              h('textarea', {
                style: { ...styles.textarea, minHeight: '320px', marginTop: '10px' },
                value: state.text,
                onChange: (event) => setState((current) => ({ ...current, text: event.target.value })),
              }),
              h('div', { style: { ...styles.wrap, marginTop: '8px' } },
                h('button', { style: styles.primary, onClick: save }, t('save')),
                state.note === null ? null : h('span', { style: styles.ok }, state.note),
              ),
            ),
      )
    }

    /**
     * Delete page.
     *
     * Deleting is destructive, so it is a two-step, user-only action — pick, then
     * confirm. The default lands the files in the recycle bin, which is shown right
     * here with restore and empty so the decision stays reversible.
     */
    function ManageTab(props) {
      const t = props.t
      const openPath = props.openPath
      const [state, setState] = React.useState({ index: null, bins: [], exports: [], mode: 'trash', retentionDays: 30, error: null })
      const [selected, setSelected] = React.useState([])
      const [query, setQuery] = React.useState('')
      const [includePapers, setIncludePapers] = React.useState(false)
      const [confirming, setConfirming] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const [tick, setTick] = React.useState(0)
      const [exportOptions, setExportOptions] = React.useState({ sections: {}, includeSource: true, cropToQuestion: true })
      const [exportSectionList, setExportSectionList] = React.useState([])
      const [exportResult, setExportResult] = React.useState(null)
      // 回收站里逐项勾选：{ [stamp]: 选中的归档相对路径[] }
      const [binPicked, setBinPicked] = React.useState({})

      // 导出板块的**默认值**来自设置页（存于归档根）。这里只在挂载时读一次：
      // 之后用户在本次导出里改动的是"这一次"，不应被后续列表刷新覆盖。
      React.useEffect(() => {
        let alive = true
        api('exportSettings', {})
          .then((value) => {
            if (!alive) return
            setExportSectionList(Array.isArray(value.sections) ? value.sections : [])
            setExportOptions({
              sections: { ...(value.settings?.sections ?? {}) },
              includeSource: value.settings?.includeSource !== false,
              cropToQuestion: value.settings?.cropToQuestion !== false,
            })
          })
          .catch(() => { /* 读不到就用全开默认 */ })
        return () => { alive = false }
      }, [])

      const toggleSection = (key) => setExportOptions((previous) => ({
        ...previous,
        sections: { ...previous.sections, [key]: previous.sections[key] === false },
      }))

      React.useEffect(() => {
        let alive = true
        Promise.all([api('library', {}), api('bin', {}), api('exports', {}), api('status', {})])
          .then(([library, bin, exports, status]) => {
            if (alive) {
              setState({
                index: library.index,
                bins: bin.bins,
                exports: exports.files,
                mode: bin.mode,
                // 归档根：宿主没下发绝对路径时，客户端自己拼出可交给系统打开的路径
                archiveRoot: status.archiveRoot,
                retentionDays: typeof bin.retentionDays === 'number' ? bin.retentionDays : 30,
                error: null,
              })
            }
          })
          .catch((error) => {
            if (alive) setState((previous) => ({ ...previous, error: error.message }))
          })
        return () => { alive = false }
      }, [tick])

      const reload = () => setTick((value) => value + 1)
      const cards = Array.isArray(state.index?.cards) ? state.index.cards : []
      const needle = query.trim().toLowerCase()
      const visible = needle === ''
        ? cards
        : cards.filter((card) => [card.id, card.paper, card.questionRef, card.difficulty, ...(card.knowledgePoints ?? []), ...(card.errorTypes ?? [])]
          .join(' ').toLowerCase().includes(needle))
      const chosen = new Set(selected)
      const toggle = (file) => setSelected((previous) => (previous.includes(file) ? previous.filter((entry) => entry !== file) : [...previous, file]))
      const toggleVisible = () => {
        const all = visible.every((card) => chosen.has(card.file))
        setSelected(all ? selected.filter((file) => !visible.some((card) => card.file === file)) : [...new Set([...selected, ...visible.map((card) => card.file)])])
      }
      // Which papers lose their last card? Only those can take their scan along.
      const touchedPapers = [...new Set(visible.filter((card) => chosen.has(card.file)).map((card) => card.paperDir))]
      const emptiedPapers = touchedPapers.filter((paperDir) => !cards.some((card) => card.paperDir === paperDir && !chosen.has(card.file)))

      const runExport = async (onlySelected) => {
        setBusy(true)
        setNote(null)
        setExportResult(null)
        try {
          const result = await api('export', {
            ...(onlySelected ? { files: selected } : {}),
            ...exportOptions,
          })
          setExportResult(result)
          setNote(t('exportedNote').replace('{n}', String(result.cards)).replace('{p}', String(result.papers)))
          reload()
        } catch (error) {
          setState((previous) => ({ ...previous, error: error.message }))
        } finally {
          setBusy(false)
        }
      }

      /**
       * 用系统默认程序打开一个导出文件。
       *
       * 之前这里是一个 `<a target="_blank">`，在桌面端（Electron）点它没有反应：
       * 壳拦下了渲染进程的 `window.open`，既不开新窗口也不交给浏览器。改走宿主
       * 的 `host.openPath`（经 workspaces 服务）才会真正落到系统默认程序上，
       * Windows 的 PDF 关联通常就是 Edge。
       */
      /**
       * 把导出项拼成**绝对路径**。
       *
       * 宿主的 `host.openPath` 只接受主机可解析的路径，而接口下发的是相对归档根
       * 的 `exports/xxx.pdf`。新版宿主会多给一个 `absolute`；宿主还没热更时用它
       * 的旧响应也能工作，所以这里用 `archiveRoot` 兜底拼接。
       */
      const absoluteOf = (entry) => {
        if (typeof entry?.absolute === 'string' && entry.absolute !== '') return entry.absolute
        const relative = typeof entry?.file === 'string' ? entry.file : ''
        if (relative === '') return undefined
        if (/^[a-zA-Z]:[\\/]/.test(relative) || relative.startsWith('\\\\')) return relative
        const root = typeof state.archiveRoot === 'string' ? state.archiveRoot : ''
        if (root === '') return undefined
        return root.replace(/[\\/]+$/, '') + '\\' + relative.replace(/\//g, '\\')
      }

      const openExported = async (entry) => {
        if (typeof openPath !== 'function') {
          setState((previous) => ({ ...previous, error: '当前宿主没有提供「在系统里打开」的能力' }))
          return
        }
        const target = absoluteOf(entry)
        if (target === undefined) {
          setState((previous) => ({ ...previous, error: `找不到可打开的文件路径：${entry?.file ?? ''}` }))
          return
        }
        setNote(null)
        try {
          await openPath(target)
          setNote(`${t('openPdf')}：${entry?.name ?? target}`)
        } catch (error) {
          setState((previous) => ({ ...previous, error: error.message ?? String(error) }))
        }
      }

      /* —— 导出管理：刷新列表 / 复制路径 / 删除 —— */

      const refreshExports = () => {
        api('exports', {})
          .then((value) => setState((previous) => ({ ...previous, exports: value.files, error: null })))
          .catch((error) => setState((previous) => ({ ...previous, error: error.message })))
      }

      const removeExport = (entry) => {
        api('exportDelete', { file: entry.file })
          .then((value) => {
            setState((previous) => ({ ...previous, exports: value.files, error: null }))
            setNote(t('exportDeleted').replace('{name}', entry.name))
          })
          .catch((error) => setState((previous) => ({ ...previous, error: error.message })))
      }

      const copyExportPath = async (entry) => {
        const target = absoluteOf(entry) ?? entry.file
        try {
          await navigator.clipboard.writeText(target)
          setNote(t('exportPathCopied'))
        } catch {
          // 没有剪贴板权限时，把路径直接显示出来让用户手抄
          setNote(`${t('exportPath')}：${target}`)
        }
      }

      const formatBytes = (bytes) => {
        const value = Number(bytes)
        if (!Number.isFinite(value) || value <= 0) return '—'
        if (value < 1024) return `${value} B`
        if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
        return `${(value / 1024 / 1024).toFixed(1)} MB`
      }

      const formatTime = (iso) => {
        const time = new Date(iso)
        return Number.isFinite(time.getTime()) ? time.toLocaleString() : ''
      }

      const toggleExportOption = (key) => setExportOptions((previous) => ({ ...previous, [key]: !previous[key] }))
      const exportOptionRow = (key, label, disabled) => h('label', {
        key,
        style: { display: 'inline-flex', gap: '6px', alignItems: 'center', marginRight: '14px', ...(disabled ? styles.muted : {}) },
      },
      h('input', { type: 'checkbox', checked: exportOptions[key], disabled: disabled === true, onChange: () => toggleExportOption(key) }),
      ` ${label}`)

      const remove = async () => {
        setBusy(true)
        setNote(null)
        try {
          const result = await api('delete', {
            files: selected,
            permanent: state.mode === 'permanent',
            includePapers,
          })
          const parts = [t('deletedNote').replace('{n}', String(result.deletedCards))]
          if (result.emptiedPapers.length > 0) parts.push(t('deletedPapersNote').replace('{n}', String(result.emptiedPapers.length)))
          if (result.unknown.length > 0) parts.push(t('skippedNote').replace('{n}', String(result.unknown.length)))
          setNote(parts.join(' '))
          setSelected([])
          setConfirming(false)
          setIncludePapers(false)
          reload()
        } catch (error) {
          setState((previous) => ({ ...previous, error: error.message }))
        } finally {
          setBusy(false)
        }
      }

      const restore = async (stamp, files) => {
        setBusy(true)
        setNote(null)
        try {
          const result = await api('binRestore', files === undefined ? { stamp } : { stamp, files })
          const parts = [t('restoredNote').replace('{n}', String(result.restored.length))]
          if (result.conflicts.length > 0) parts.push(t('conflictNote').replace('{n}', String(result.conflicts.length)))
          setNote(parts.join(' '))
          if (files !== undefined) setBinPicked((previous) => {
            const next = { ...previous }
            delete next[stamp]
            return next
          })
          reload()
        } catch (error) {
          setState((previous) => ({ ...previous, error: error.message }))
        } finally {
          setBusy(false)
        }
      }

      /** 勾选 / 取消某一条被删条目。 */
      const toggleBinItem = (stamp, file) => setBinPicked((previous) => {
        const current = previous[stamp] ?? []
        const next = current.includes(file) ? current.filter((entry) => entry !== file) : [...current, file]
        const merged = { ...previous }
        if (next.length === 0) delete merged[stamp]
        else merged[stamp] = next
        return merged
      })

      /** 整批全选 / 取消全选。 */
      const toggleAllInBin = (stamp, items) => setBinPicked((previous) => {
        const current = previous[stamp] ?? []
        const all = items.length > 0 && items.every((file) => current.includes(file))
        const merged = { ...previous }
        if (all) delete merged[stamp]
        else merged[stamp] = [...items]
        return merged
      })

      const empty = async (stamp) => {
        setBusy(true)
        setNote(null)
        try {
          await api('binEmpty', stamp === undefined ? {} : { stamp })
          setNote(t('binEmptiedNote'))
          reload()
        } catch (error) {
          setState((previous) => ({ ...previous, error: error.message }))
        } finally {
          setBusy(false)
        }
      }

      return h('div', null,
        h('div', { style: { ...styles.small, marginBottom: '4px' } }, t('manageIntro')),
        state.error === null ? null : h('div', { style: { ...styles.card, ...styles.error } }, `${t('failed')}: ${state.error}`),
        note === null ? null : h('div', { style: { ...styles.card, ...styles.ok } }, note),

        h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('div', { style: styles.label }, t('exportTitle')),
            h('div', { style: { flex: '1 1 auto' } }),
            h('button', { style: styles.button, onClick: () => runExport(false), disabled: busy || cards.length === 0 }, busy ? t('working') : t('exportAll')),
            h('button', { style: styles.primary, onClick: () => runExport(true), disabled: busy || selected.length === 0 }, busy ? t('working') : t('exportSelected')),
          ),
          h('div', { style: styles.small },
            exportSectionList.map((section) => h('label', {
              key: section.key,
              style: { display: 'inline-flex', alignItems: 'center', gap: '6px', marginRight: '12px' },
            },
            h('input', {
              type: 'checkbox',
              checked: exportOptions.sections[section.key] !== false,
              onChange: () => toggleSection(section.key),
            }),
            ` ${section.label}`)),
          ),
          h('div', { style: styles.small },
            exportOptionRow('includeSource', t('optSource')),
            exportOptionRow('cropToQuestion', t('optCrop'), !exportOptions.includeSource),
          ),
          h('div', { style: styles.small }, t('exportHint')),
          exportResult === null ? null : h('div', { style: { ...styles.small, ...styles.ok } },
            h('button', { style: styles.button, onClick: () => openExported(exportResult) }, t('openPdf')),
            `　${exportResult.file}`,
            exportResult.missingFonts.length > 0 ? `　${t('missingFonts').replace('{n}', exportResult.missingFonts.join('、'))}` : '',
          ),
        ),

        h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('div', { style: styles.label }, `${t('exportManage')}（${state.exports.length}）`),
            h('div', { style: { flex: '1 1 auto' } }),
            h('button', { style: styles.button, onClick: refreshExports, disabled: busy }, t('refresh')),
          ),
          h('div', { style: styles.small }, t('exportManageHint')),
          state.exports.length === 0
            ? h('div', { style: { ...styles.muted, marginTop: '6px' } }, t('exportEmpty'))
            : h('div', { style: { marginTop: '6px' } }, state.exports.map((entry) => h('div', {
                key: entry.file,
                style: { ...styles.row, alignItems: 'flex-start', marginTop: '8px' },
              },
              h('div', { style: { minWidth: '0', flex: '1 1 auto' } },
                h('button', { style: styles.button, onClick: () => openExported(entry) }, entry.name),
                h('div', { style: styles.small },
                  (entry.meta
                    ? t('exportMeta').replace('{cards}', String(entry.meta.cards ?? '—')).replace('{papers}', String(entry.meta.papers ?? '—'))
                    : t('exportMetaUnknown'))
                  + `　${formatBytes(entry.bytes)}　${formatTime(entry.meta?.createdAt ?? entry.at)}`),
                h('div', { style: styles.muted }, entry.file),
              ),
              h('div', { style: styles.wrap },
                h('button', { style: styles.button, onClick: () => copyExportPath(entry) }, t('exportCopyPath')),
                h('button', { style: { ...styles.button, ...styles.danger }, onClick: () => removeExport(entry) }, t('deleteTemplate')),
              ),
            ))),
        ),

        h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('input', {
              style: { ...styles.input, flex: '1 1 200px' },
              placeholder: t('search'),
              value: query,
              onChange: (event) => setQuery(event.target.value),
            }),
            h('button', { style: styles.button, onClick: toggleVisible, disabled: visible.length === 0 }, t('selectAll')),
            h('button', { style: styles.button, onClick: () => { setSelected([]); setConfirming(false) }, disabled: selected.length === 0 }, t('clearSelection')),
          ),
          h('div', { style: styles.small }, t('manageHint')),
        ),

        cards.length === 0
          ? h('div', { style: styles.card }, h('div', { style: styles.muted }, t('noCards')))
          : h('div', { style: styles.card },
            h('div', { style: styles.row },
              h('div', { style: styles.label }, t('selectedCount').replace('{n}', String(selected.length))),
              h('div', { style: { flex: '1 1 auto' } }),
              confirming
                ? h('span', { style: styles.row },
                  h('button', { style: { ...styles.button, ...styles.danger }, onClick: remove, disabled: busy || selected.length === 0 }, busy ? t('working') : t('confirmDelete')),
                  h('button', { style: styles.button, onClick: () => setConfirming(false), disabled: busy }, t('cancel')),
                )
                : h('button', {
                  style: { ...styles.button, ...(selected.length === 0 ? {} : styles.danger) },
                  onClick: () => setConfirming(true),
                  disabled: selected.length === 0,
                }, t('deleteSelected')),
            ),
            confirming
              ? h('div', { style: { ...styles.small, ...styles.warn } },
                state.mode === 'permanent' ? t('deletePermanentNote') : t('deleteToTrashNote'),
                emptiedPapers.length > 0
                  ? h('label', { style: { display: 'block', marginTop: '6px' } },
                    h('input', { type: 'checkbox', checked: includePapers, onChange: (event) => setIncludePapers(event.target.checked) }),
                    ` ${t('includePapers').replace('{n}', String(emptiedPapers.length))}`)
                  : null,
              )
              : null,
            visible.length === 0
              ? h('div', { style: styles.muted }, t('noMatch'))
              : visible.map((card) => h('label', {
                key: card.file,
                style: { ...styles.batchRow, display: 'flex', gap: '8px', alignItems: 'flex-start' },
              },
              h('input', { type: 'checkbox', checked: chosen.has(card.file), onChange: () => toggle(card.file) }),
              h('div', { style: { minWidth: '0' } },
                h('div', null, `${card.id}　${t('questionShort')}${card.questionRef}　${card.difficulty}`),
                h('div', { style: styles.small }, `${card.paper}　${(card.knowledgePoints ?? []).join('｜')}`),
                h('div', { style: styles.muted }, card.file),
              ))),
          ),

        h('div', { style: styles.card },
          h('div', { style: styles.row },
            h('div', { style: styles.label }, `${t('bin')}（${state.bins.length}）`),
            h('div', { style: { flex: '1 1 auto' } }),
            state.bins.length === 0 ? null : h('button', { style: styles.button, onClick: () => empty(), disabled: busy }, t('emptyAllBins')),
          ),
          state.bins.length === 0
            ? h('div', { style: styles.muted }, t('binEmpty'))
            : state.bins.map((bin) => {
              const ageDays = Math.floor((Date.now() - new Date(bin.at).getTime()) / 86400000)
              const stale = Number.isFinite(ageDays) && ageDays >= state.retentionDays
              const picked = binPicked[bin.stamp] ?? []
              const allPicked = bin.items.length > 0 && bin.items.every((file) => picked.includes(file))
              return h('div', { key: bin.stamp, style: styles.batchRow },
                h('div', { style: styles.row },
                  h('div', null, `${bin.stamp}　${t('binItems').replace('{n}', String(bin.items.length))}　${t('binAge').replace('{n}', String(Number.isFinite(ageDays) ? ageDays : 0))}`),
                  stale ? h('span', { style: { ...styles.chip, ...styles.warn } }, t('binStale').replace('{n}', String(state.retentionDays))) : null,
                  h('div', { style: { flex: '1 1 auto' } }),
                  picked.length === 0 ? null : h('button', {
                    style: styles.primary,
                    onClick: () => restore(bin.stamp, picked),
                    disabled: busy,
                  }, `${t('restorePicked')}（${picked.length}）`),
                  h('button', { style: styles.button, onClick: () => restore(bin.stamp), disabled: busy }, t('restoreAll')),
                  h('button', { style: { ...styles.button, ...styles.danger }, onClick: () => empty(bin.stamp), disabled: busy }, t('emptyBin')),
                ),
                h('div', { style: { marginTop: '6px' } },
                  h('label', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px', ...styles.small } },
                    h('input', { type: 'checkbox', checked: allPicked, onChange: () => toggleAllInBin(bin.stamp, bin.items) }),
                    ` ${t('selectAllInBin')}`,
                  ),
                  bin.items.map((file) => h('label', {
                    key: file,
                    style: { display: 'flex', alignItems: 'center', gap: '6px', ...styles.muted, marginTop: '2px', wordBreak: 'break-all' },
                  },
                  h('input', { type: 'checkbox', checked: picked.includes(file), onChange: () => toggleBinItem(bin.stamp, file) }),
                  ` ${file}`)),
                ),
              )
            }),
        ),
      )
    }

    function App(props) {
      const t = props.t
      const openPath = props.openPath
      const openSession = props.openSession
      const [tab, setTab] = React.useState('pending')
      // 「管理」是「已归档」的子页：删除卡片、回收站、导出都只作用于已归档的内容，
      // 放在顶层会让人误以为它也管待归档的批次。
      const [libraryPane, setLibraryPane] = React.useState('browse')
      return h(Boundary, null,
        h('div', { style: styles.root },
          h('div', { style: { borderBottom: `1px solid ${token('--dsw-alias-border-l1')}` } },
            h('button', { style: styles.tab(tab === 'pending'), onClick: () => setTab('pending') }, t('tabPending')),
            h('button', { style: styles.tab(tab === 'library'), onClick: () => setTab('library') }, t('tabLibrary')),
            h('button', { style: styles.tab(tab === 'settings'), onClick: () => setTab('settings') }, t('tabSettings')),
          ),
          tab === 'pending' ? h(Boundary, null, h(PendingTab, { t, openSession })) : null,
          tab === 'library' ? h(Boundary, null, h('div', null,
            h('div', { style: { ...styles.wrap, margin: '10px 0' } },
              h('button', {
                style: { ...styles.button, ...(libraryPane === 'browse' ? styles.active : {}) },
                onClick: () => setLibraryPane('browse'),
              }, t('libraryBrowse')),
              h('button', {
                style: { ...styles.button, ...(libraryPane === 'manage' ? styles.active : {}) },
                onClick: () => setLibraryPane('manage'),
              }, t('libraryManage')),
            ),
            libraryPane === 'browse'
              ? h(LibraryTab, { t })
              : h(ManageTab, { t, openPath }),
          )) : null,
          tab === 'settings' ? h(Boundary, null, h(SettingsTab, { t })) : null,
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // Every label goes through this, so a locale failure (a namespace that is
        // not registered yet, or a translator that throws for an unknown key) would
        // otherwise take the whole page down. Falling back to the key keeps the UI.
        const translate = ctx.locale.bind(NS)
        const t = (key) => {
          try {
            const out = translate(key)
            return typeof out === 'string' && out !== '' ? out : key
          } catch {
            return key
          }
        }
        /**
         * 交给宿主用**系统默认程序**打开一个文件。
         *
         * 两个坑，都踩过：
         * 1. `<a target="_blank">` 在桌面端（Electron）无效——壳拦下渲染进程的
         *    `window.open`，点了既不开新窗口也不交给浏览器，表现就是"没反应"。
         * 2. `ctx.get('workspaces')` 不是**插件可用的**宿主能力入口（那是运行时
         *    内部的服务），拿到的永远是 undefined。客户端插件要走
         *    `ctx.connection.api.host.openPath`——协议消费层专为插件挂载的共享
         *    API 客户端，且 `host.openPath` 只允许回环调用（桌面端满足）。
         */
        const openPath = async (target) => {
          if (typeof target !== 'string' || target.trim() === '') throw new Error('没有可打开的文件路径')
          let connection
          try {
            connection = ctx.get('connection')
          } catch {
            connection = undefined
          }
          if (connection === undefined) connection = ctx.connection
          if (connection === undefined) {
            throw new Error(`客户端拿不到 connection 服务（插件依赖变更需重启 DSH 才生效），请手动打开：${target}`)
          }
          const call = connection?.api?.host?.openPath
          if (typeof call !== 'function') {
            throw new Error(`当前宿主没有提供「在系统里打开」的能力，请手动打开：${target}`)
          }
          const response = await call.call(connection.api.host, { path: target })
          const result = response?.result
          if (result === undefined || result.ok !== true) {
            const reason = result?.error?.message ?? '调用被宿主拒绝'
            throw new Error(`在系统里打开失败：${reason}（路径：${target}）`)
          }
        }

        /**
         * 跳到某个会话。
         *
         * DSH 没有为第三方客户端插件公开「切换当前会话」的官方 API；`sessions`
         * 是运行时在根上下文里提供的内部服务。这里按"能拿到就用"处理：依次尝试
         * 几个已知的形态，全都不成立时把会话 id 告诉用户，让他在侧栏里打开。
         */
        const openSession = async (sessionId) => {
          if (typeof sessionId !== 'string' || sessionId === '') throw new Error('这个批次没有关联会话')
          let sessions
          try {
            sessions = ctx.get('sessions')
          } catch {
            sessions = undefined
          }
          if (sessions === undefined) sessions = ctx.sessions
          const attempts = [
            () => sessions?.manager?.select?.(sessionId),
            () => sessions?.select?.(sessionId),
            () => sessions?.selection?.set?.({ sessionId }),
            () => sessions?.list?.set?.((previous) => ({ ...previous, current: sessionId })),
          ]
          for (const attempt of attempts) {
            try {
              if (attempt() !== undefined) return sessionId
            } catch {
              /* 换下一种形态 */
            }
          }
          throw new Error(`当前宿主不支持从插件跳转会话，请在左侧「AI 错题本」工作区里打开：${sessionId}`)
        }

        ctx.effect(() => {
          const offZh = ctx.locale.register(NS, 'zh', ZH)
          const offEn = ctx.locale.register(NS, 'en', EN)
          return () => {
            offZh()
            offEn()
          }
        }, 'ai-mistake-book: dictionaries')

        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'mistake-book',
          order: 19,
          // The nav label is read by the settings shell itself, so a failure here
          // would blank the whole Settings panel, not just this page.
          label: () => {
            try {
              return t('nav')
            } catch {
              return 'AI 错题本'
            }
          },
          inject: () => ({ t, openPath, openSession }),
        }, App))

        // A first-class panel in the left sidebar. `sidebar.panellist` ids address
        // `main` keys, so one id gives a permanent entry point to the plugin UI that
        // the user does not have to reach through Settings.
        function Panel() {
          return h('div', {
            style: { height: '100%', boxSizing: 'border-box', overflowY: 'auto', padding: '18px 22px' },
          }, h(Boundary, null, h(App, { t, openPath, openSession })))
        }

        function PanelIcon(props) {
          const size = Number.isFinite(props.size) && props.size > 0 ? props.size : 20
          return h('svg', {
            width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
            'aria-hidden': true, style: { display: 'block' },
          },
          h('rect', { x: 3.2, y: 4.2, width: 17.6, height: 15.6, rx: 2.4, stroke: 'currentColor', strokeWidth: 1.5 }),
          h('path', { d: 'M6.8 9.2h6.6M6.8 12.6h7.4M6.8 16h4.4', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
          h('circle', { cx: 17.2, cy: 16.4, r: 3.4, fill: 'currentColor' }),
          h('path', { d: 'M15.9 16.4l1 1 1.7-1.9', stroke: 'var(--dsw-alias-bg-base)', strokeWidth: 1.3, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }),
          )
        }

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'mistake-book',
          order: 20,
          label: () => t('nav'),
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'mistake-book' }, Panel))
      },
    }
  },
})
