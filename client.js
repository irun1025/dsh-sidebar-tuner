/* Left Sidebar Tuner v2 — 左侧栏优化：入口显隐 + 两条横条拉伸（入口区 / 底部动作区）。 */
window.__ModuleLoader__.load({
  id: 'dsh-sidebar-tuner',
  factory(require) {
    'use strict'
    const React = require('react')
    const h = React.createElement
    const NS = 'sidebarTuner'
    const PANEL_ID = 'sidebar-tuner'
    const PREFS_KEY = 'dsh-sidebar-tuner:prefs:v2'
    // 旧包名下的偏好键。v2.1.0 改名时保留迁移，老用户装新版不丢开关与高度。
    const LEGACY_PREFS_KEYS = ['dsh-sidebar-studio:prefs:v2']
    // schema 3 = 本版语义（两条横条：nav / footerActions）。
    // 读到别的 schema 一律丢弃高度、只保留入口显隐 —— 旧版把「第一段高度」写进同一个键，
    // 照读会把入口区钉死、工作区压没。这条隔离是上一轮「全乱套」的直接教训。
    const SCHEMA = 3
    // null = 交回宿主的自动高度；0 = 用户主动压到 0。两者必须分开，
    // 否则拖到 0 会被误读成「恢复自动」，横条也会瞬间跳走。
    const DEFAULTS = { entries: {}, navHeight: null, footerHeight: null }
    const REGION_FLOOR = 48
    const MAX_HEIGHT = 4000

    const listeners = new Set()
    let snapshot = readPreferences()
    let pinnedChannel = null
    let pinnedWired = false
    let resizeHandle = null

    const DICTS = {
      zh: {
        'panel.label': '左侧栏优化', 'panel.title': '左侧栏优化',
        'panel.desc': '管理左侧栏入口的显示与隐藏，并拖动两条横条调整入口区与底部动作区的高度。偏好只保存在本机。',
        'entries.title': '面板入口',
        'entries.desc': '关掉的入口仍可从「更多」菜单打开。',
        'entries.always': '宿主固定', 'entries.reset': '全部显示', 'entries.empty': '暂无可管理的入口。',
        'entries.nopin': '当前宿主没有提供入口显隐通道，本节的开关不会生效。',
        'layout.title': '区域高度',
        'layout.desc': '上横条在「入口区」下沿：向下拖入口区变高。下横条在底部动作区上沿：向上拖底部动作区变高。双击横条或点「恢复自动」交回宿主的自动高度。头像行与品牌行是宿主原装的，本插件不写它们的样式。',
        'layout.nav': '入口区',
        'layout.footer': '底部动作区',
        'layout.auto': '自动', 'layout.custom': '自定义',
        'layout.narrower': '减少 16 px', 'layout.wider': '增加 16 px', 'layout.resetOne': '恢复自动',
        'layout.reset': '恢复默认布局', 'layout.resetDone': '已恢复默认布局。',
        'menu.section': '面板入口', 'menu.manage': '优化侧栏与布局…',
        'settings.label': '左侧栏优化', 'settings.hint': '入口显示与区域尺寸共用同一份本机偏好。',
        'panel.note': '「插件」入口由宿主固定显示。头像行是宿主原装的，本插件不写它。整栏宽度请直接拖侧栏右边缘。',
      },
      en: {
        'panel.label': 'Left Sidebar Tuner', 'panel.title': 'Left Sidebar Tuner',
        'panel.desc': 'Show or hide sidebar entries, and drag two bars to resize the entry area and the footer actions. Preferences stay on this machine.',
        'entries.title': 'Panel entries',
        'entries.desc': 'Hidden entries stay reachable from the More menu.',
        'entries.always': 'Fixed by host', 'entries.reset': 'Show all', 'entries.empty': 'No entries to manage.',
        'entries.nopin': 'This host build exposes no entry visibility channel, so these switches will not take effect.',
        'layout.title': 'Region heights',
        'layout.desc': 'The upper bar sits under the entry area: drag down to grow it. The lower bar sits on top of the footer actions: drag up to grow them. Double-click a bar or press Restore automatic to hand that region back to the host. The avatar row and brand row are shipped as-is and this plugin never styles them.',
        'layout.nav': 'Entry area',
        'layout.footer': 'Footer actions',
        'layout.auto': 'Automatic', 'layout.custom': 'Custom',
        'layout.narrower': 'Shrink by 16 px', 'layout.wider': 'Grow by 16 px', 'layout.resetOne': 'Restore automatic',
        'layout.reset': 'Reset layout', 'layout.resetDone': 'Default layout restored.',
        'menu.section': 'Panel entries', 'menu.manage': 'Manage sidebar and layout…',
        'settings.label': 'Left Sidebar Tuner', 'settings.hint': 'Entry and region preferences are saved locally.',
        'panel.note': 'Plugins is fixed by the host. The avatar row is shipped as-is and this plugin never styles it. Drag the sidebar edge for column width.',
      },
    }

    /* ---------------------------------------------------------------- 偏好 */

    function readHeight(value) {
      // null/undefined/NaN = 自动（交回宿主）；0 = 主动压到 0；正数 = 自定义高度。
      if (value === null || value === undefined || !Number.isFinite(value)) return null
      return Math.max(0, Math.round(Math.min(MAX_HEIGHT, value)))
    }
    // 改名迁移：新键为空时，把旧键的值搬过来并删掉旧键。
    // 只在「新键确实没有值」时搬，避免把用户在新版里的最新选择覆盖回旧值。
    function migrateLegacyPreferences() {
      try {
        if (window.localStorage.getItem(PREFS_KEY) != null) return
        for (const legacyKey of LEGACY_PREFS_KEYS) {
          const raw = window.localStorage.getItem(legacyKey)
          if (raw == null) continue
          window.localStorage.setItem(PREFS_KEY, raw)
          window.localStorage.removeItem(legacyKey)
          return
        }
      } catch (_) {}
    }
    function readPreferences() {
      try {
        migrateLegacyPreferences()
        const raw = window.localStorage.getItem(PREFS_KEY)
        const value = raw ? JSON.parse(raw) : null
        if (!value || typeof value !== 'object') return { ...DEFAULTS }
        const entries = value.entries && typeof value.entries === 'object' && !Array.isArray(value.entries) ? value.entries : {}
        if (value.schema !== SCHEMA) return { ...DEFAULTS, entries }
        return { entries, navHeight: readHeight(value.navHeight), footerHeight: readHeight(value.footerHeight) }
      } catch (_) { return { ...DEFAULTS } }
    }
    function persistable(value) {
      return {
        schema: SCHEMA,
        entries: value.entries || {},
        navHeight: Number.isFinite(value.navHeight) ? value.navHeight : null,
        footerHeight: Number.isFinite(value.footerHeight) ? value.footerHeight : null,
      }
    }
    function publish(next) {
      snapshot = next
      try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(persistable(next))) } catch (_) {}
      listeners.forEach((listener) => { try { listener() } catch (_) {} })
    }
    function subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) }
    function usePreferences() {
      const [value, setValue] = React.useState(snapshot)
      React.useEffect(() => subscribe(() => setValue(snapshot)), [])
      return value
    }

    /* ------------------------------------------------------- 入口显隐通道 */

    function applyPin(id, visible) {
      if (id === 'plugins') return false
      if (typeof pinnedChannel !== 'function') return false
      try { pinnedChannel(id, visible); return true } catch (_) { return false }
    }
    function setEntryVisible(id, visible) {
      if (id === 'plugins') return
      const entries = { ...snapshot.entries }
      if (visible) delete entries[id]
      else entries[id] = false
      publish({ ...snapshot, entries })
      applyPin(id, visible)
    }
    function syncPins() {
      Object.keys(snapshot.entries).forEach((id) => applyPin(id, false))
    }
    // 宿主的 pin 通道通过 sidebar 座位的 inject 暴露（宿主 :600 setPinned）。
    // 只在启动时拿一次：入口菜单的 children 是打开时才挂载的，靠它取会首屏失效。
    function attachPins(ctx) {
      const attach = () => {
        if (pinnedWired) return () => {}
        let list = []
        try { list = ctx.slots.entries('sidebar') } catch (_) { list = [] }
        for (const entry of list) {
          let injected = null
          try { injected = typeof entry.inject === 'function' ? entry.inject() : null } catch (_) { continue }
          if (injected && typeof injected.setPinned === 'function') {
            pinnedChannel = injected.setPinned
            pinnedWired = true
            syncPins()
            return
          }
        }
      }
      attach()
      let off = () => {}
      try { off = ctx.slots.subscribe('sidebar', attach) } catch (_) {}
      const frame = requestAnimationFrame(attach)
      const timer = window.setTimeout(attach, 400)
      return () => {
        off()
        cancelAnimationFrame(frame)
        window.clearTimeout(timer)
      }
    }
    function usePanelEntries(ctx) {
      const read = () => {
        try { return ctx.slots.entriesOfSlot('sidebar.panellist').slice() } catch (_) {}
        try { return ctx.slots.entries('sidebar.panellist').slice() } catch (_) { return [] }
      }
      const [entries, setEntries] = React.useState(read)
      React.useEffect(() => {
        const sync = () => setEntries(read())
        sync()
        let off = () => {}
        try { off = ctx.slots.subscribe('sidebar.panellist', sync) } catch (_) {}
        return off
      }, [ctx])
      return entries
    }
    function entryLabel(options, fallback) {
      try { return typeof options.label === 'function' ? options.label() : options.label || fallback } catch (_) { return fallback }
    }

    /* --------------------------------------------------------------- 组件 */

    function Toggle({ checked, label, onChange }) {
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
        className: `dst-switch${checked ? ' is-on' : ''}`, onClick: () => onChange(!checked),
      }, h('span'))
    }
    function EntryGlyph({ size = 18 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
        h('rect', { x: 2.5, y: 2.5, width: 15, height: 15, rx: 3, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { d: 'M7.5 3v14M10.5 6.5h4M10.5 10h4M10.5 13.5h3', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))
    }
    function Entries({ entries, preferences, t }) {
      if (!entries.length) return h('p', { className: 'dst-note-inline' }, t('entries.empty'))
      const sorted = entries.slice().sort((a, b) => (a.options.order || 0) - (b.options.order || 0))
      return h('div', null,
        pinnedWired ? null : h('p', { className: 'dst-warn', role: 'status' }, t('entries.nopin')),
        h('ul', { className: 'dst-list' }, sorted.map((entry) => {
          const id = entry.options.id
          const label = entryLabel(entry.options, id)
          const locked = id === 'plugins'
          return h('li', { className: 'dst-entry', key: id },
            h('div', null, h('span', { className: 'dst-entry-title' }, label), h('code', null, id)),
            locked ? h('span', { className: 'dst-lock' }, t('entries.always')) : h(Toggle, {
              checked: preferences.entries[id] !== false, label,
              onChange: (visible) => setEntryVisible(id, visible),
            }))
        })))
    }
    function SizeRow({ label, value, hint, auto, t, onStep, onReset }) {
      const shown = auto ? t('layout.auto') : `${value} px`
      return h('div', { className: 'dst-row' },
        h('div', { className: 'dst-row-label' }, h('span', null, label), h('small', null, hint)),
        h('div', { className: 'dst-row-actions' },
          h('button', { type: 'button', className: 'dst-step', 'aria-label': t('layout.narrower'), onClick: () => onStep(-16) }, '−'),
          h('output', { className: 'dst-value' }, shown),
          h('button', { type: 'button', className: 'dst-step', 'aria-label': t('layout.wider'), onClick: () => onStep(16) }, '+'),
          h('button', { type: 'button', className: 'dst-button dst-small', onClick: onReset }, t('layout.resetOne'))))
    }
    function makePanel(ctx, t, variant) {
      return function SidebarStudioPanel() {
        const entries = usePanelEntries(ctx)
        const prefs = usePreferences()
        const [message, setMessage] = React.useState('')
        const resetEntries = () => {
          const ids = Object.keys(snapshot.entries)
          publish({ ...snapshot, entries: {} })
          ids.forEach((id) => applyPin(id, true))
        }
        // null = 交回宿主的自动高度；数字（包括 0）= 用户指定的像素值。
        const setNav = (next) => {
          if (resizeHandle) resizeHandle.setNav(next)
          else publish({ ...snapshot, navHeight: Number.isFinite(next) ? next : null })
        }
        const setFooter = (next) => {
          if (resizeHandle) resizeHandle.setFooter(next)
          else publish({ ...snapshot, footerHeight: Number.isFinite(next) ? next : null })
        }
        const step = (current, delta) => Math.max(0, Math.min(MAX_HEIGHT, (current || 0) + delta))
        const resetLayout = () => {
          if (resizeHandle) resizeHandle.reset()
          else publish({ ...snapshot, navHeight: null, footerHeight: null })
          setMessage(t('layout.resetDone'))
        }
        const size = resizeHandle ? resizeHandle.measure() : { nav: 0, footer: 0, navAuto: true, footerAuto: true }
        const frameClass = variant === 'settings' ? 'dst-frame is-settings' : 'dst-frame'
        return h('div', { className: frameClass },
          h('div', { className: 'dst-scroll' },
            h('div', { className: 'dst-root' },
              h('header', null, h('h2', null, t('panel.title')), h('p', null, t('panel.desc'))),
              h('section', null, h('h3', null, t('entries.title')), h('p', null, t('entries.desc')),
                h(Entries, { entries, preferences: prefs, t }),
                h('button', { className: 'dst-button', type: 'button', onClick: resetEntries }, t('entries.reset'))),
              h('section', null, h('h3', null, t('layout.title')), h('p', null, t('layout.desc')),
                h(SizeRow, {
                  label: t('layout.nav'), value: size.nav, auto: size.navAuto,
                  hint: size.navAuto ? t('layout.auto') : t('layout.custom'),
                  t, onStep: (delta) => setNav(step(size.nav, delta)), onReset: () => setNav(null),
                }),
                h(SizeRow, {
                  label: t('layout.footer'), value: size.footer, auto: size.footerAuto,
                  hint: size.footerAuto ? t('layout.auto') : t('layout.custom'),
                  t, onStep: (delta) => setFooter(step(size.footer, delta)), onReset: () => setFooter(null),
                }),
                h('button', { className: 'dst-button', type: 'button', onClick: resetLayout }, t('layout.reset')),
                message && h('p', { className: 'dst-success', role: 'status' }, message)),
              h('p', { className: 'dst-note' }, t('panel.note')))))
      }
    }
    function makeMenu(ctx, t) {
      return function StudioMenu({ entries = [], onOpen, onPinnedChange, onDismiss }) {
        const prefs = usePreferences()
        if (typeof onPinnedChange === 'function') {
          pinnedChannel = onPinnedChange
          pinnedWired = true
        }
        const open = (id) => { onDismiss?.(); onOpen?.(id) }
        return h('div', { className: 'dst-menu' },
          h('div', { className: 'dst-menu-heading' }, t('menu.section')),
          entries.map((entry) => {
            const locked = entry.id === 'plugins'
            const visible = prefs.entries[entry.id] !== false
            return h('div', { className: 'dst-menu-item', key: entry.id },
              h('button', { type: 'button', className: `dst-menu-open${entry.active ? ' is-active' : ''}`, onClick: () => open(entry.id) },
                h('span', null, entry.label || entry.id)),
              locked
                ? h('small', null, t('entries.always'))
                : h('button', {
                    type: 'button', role: 'switch', 'aria-checked': visible,
                    'aria-label': entry.label || entry.id, className: `dst-switch dst-switch-sm${visible ? ' is-on' : ''}`,
                    onClick: () => setEntryVisible(entry.id, !visible),
                  }, h('span')))
          }),
          h('button', { type: 'button', className: 'dst-menu-item dst-manage', onClick: () => { onDismiss?.(); ctx.layout.selectPanel(PANEL_ID) } }, t('menu.manage')))
      }
    }

    /* --------------------------------------------------------------- 样式 */

    const CSS = `
.dst-frame{display:flex;flex-direction:column;flex:1 1 auto;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary)}
.dst-scroll{flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;padding:16px 20px 24px}
.dst-scroll::-webkit-scrollbar{width:8px}.dst-scroll::-webkit-scrollbar-thumb{border-radius:4px;background:var(--dsw-alias-border-l2)}.dst-scroll::-webkit-scrollbar-track{background:transparent}
.dst-frame.is-settings{height:auto;overflow:visible}
.dst-frame.is-settings .dst-scroll{flex:none;overflow:visible;padding:0}
.dst-root{display:flex;flex-direction:column;gap:24px;max-width:720px;color:var(--dsw-alias-label-primary)}
.dst-root header,.dst-root section{display:flex;flex-direction:column;gap:10px}.dst-root h2,.dst-root h3,.dst-root p{margin:0}.dst-root h2{font-size:18px}.dst-root h3{font-size:14px}.dst-root p{font-size:13px;line-height:1.65;color:var(--dsw-alias-label-secondary)}
.dst-list{list-style:none;padding:0;margin:0 0 4px;display:flex;flex-direction:column;gap:6px}.dst-entry{display:flex;align-items:center;gap:16px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2)}.dst-entry>div{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}.dst-entry-title{font-size:13px}.dst-entry code{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis}.dst-lock,.dst-menu small,.dst-row-label small{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dst-switch{width:38px;height:22px;flex:none;position:relative;padding:0;border:1px solid var(--dsw-alias-border-l2);border-radius:99px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}.dst-switch span{position:absolute;width:16px;height:16px;top:2px;left:2px;border-radius:50%;background:white;box-shadow:0 1px 3px #0004;transition:transform .15s}.dst-switch.is-on{background:var(--dsw-alias-state-business-primary,#6c5ce7)}.dst-switch.is-on span{transform:translateX(16px)}
.dst-switch-sm{width:30px;height:18px}.dst-switch-sm span{width:12px;height:12px}.dst-switch-sm.is-on span{transform:translateX(12px)}
.dst-switch:focus-visible,.dst-button:focus-visible,.dst-menu-open:focus-visible,.dst-step:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary,#6c5ce7);outline-offset:2px}
.dst-button{align-self:flex-start;padding:6px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}.dst-button:hover{background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2))}.dst-small{padding:3px 9px;font-size:12px}
.dst-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px}.dst-row-label{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;font-size:13px}.dst-row-actions{display:flex;align-items:center;gap:6px}
.dst-step{width:26px;height:26px;display:grid;place-items:center;border:1px solid var(--dsw-alias-border-l2);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;font-size:14px;line-height:1}
.dst-value{min-width:74px;text-align:center;font-variant-numeric:tabular-nums;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dst-success{color:var(--dsw-alias-state-success,#39a36c)!important}.dst-warn{color:var(--dsw-alias-state-warning,#d08700)!important;font-size:12px!important}.dst-note{border-top:1px solid var(--dsw-alias-border-l3);padding-top:16px}.dst-note-inline{font-size:12px}
.dst-menu{min-width:220px;max-width:300px;display:flex;flex-direction:column;gap:2px}.dst-menu-heading{font-size:11px;padding:4px 10px;color:var(--dsw-alias-label-secondary)}
.dst-menu-item{display:flex;align-items:center;gap:8px;width:100%;padding:4px 10px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left}
.dst-menu-open{flex:1;min-width:0;display:flex;padding:4px 0;border:0;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.dst-menu-open:hover,.dst-menu-open.is-active{color:var(--dsw-alias-state-business-primary,#6c5ce7)}
.dst-menu-item:hover{background:var(--dsw-alias-bg-layer-3,var(--dsw-alias-bg-layer-2))}.dst-menu-item>small{flex:none}
.dst-manage{margin-top:6px;border-top:1px solid var(--dsw-alias-border-l2);cursor:pointer;padding:7px 10px}
.dst-grip{position:fixed;height:8px;border:0;padding:0;background:transparent;cursor:row-resize;touch-action:none;z-index:60;display:flex;align-items:center;justify-content:center;opacity:.5;transition:opacity .12s}
.dst-grip:before{content:'';width:34px;height:3px;border-radius:4px;background:var(--dsw-alias-border-l2);transition:background .12s,width .12s}
.dst-grip:hover,.dst-grip:focus-visible,.dst-grip[data-dragging=true]{opacity:1}
.dst-grip:hover:before,.dst-grip:focus-visible:before,.dst-grip[data-dragging=true]:before{background:var(--dsw-alias-state-business-primary,#6c5ce7);width:56px}
.dst-grip:focus-visible{outline:none}
body.dst-resizing{user-select:none!important;cursor:row-resize!important}body.dst-resizing *{cursor:row-resize!important}
`

    /* ----------------------------------------------------- 两条横条与高度 */

    /**
     * 宿主 ui-sidebar 的类名是 CSS Module 形式 `<hash>_localName`，hash 随构建变；
     * 本地名稳定，所以一律用 `endsWith('_' + localName)` 匹配，不做硬编码前缀。
     *
     * 宿主 div.root 的直接子节点顺序（ui-sidebar :383-519）：
     *   [topStrip] | logoRow | newSession | nav.panelList | div.regionArea | div.footArea(footerActions + settingsArea)
     *
     * 本插件只碰三个元素：
     *   - nav.panelList        → 入口区高度（横条 1）
     *   - div.footerActions    → 底部动作区高度（横条 2）
     *   - div.regionArea       → 恒 flex:1 吃余量（两条横条之间的「工作区」）
     * logoRow / newSession / settingsArea（头像行）/ footArea 本身一个样式都不写。
     */
    function installResize() {
      const nodes = { root: null, nav: null, region: null, foot: null, actions: null, settings: null }
      const grips = []
      let disposed = false
      let frameToken = 0
      let timerToken = 0

      function localName(el, suffix) {
        const names = String((el && el.className) || '').split(/\s+/)
        for (const name of names) if (name.endsWith('_' + suffix)) return true
        return false
      }
      function directChild(parent, suffix) {
        if (!parent) return null
        for (const child of parent.children) if (localName(child, suffix)) return child
        return null
      }
      function findNodes() {
        const regions = document.querySelectorAll('[class*="_regionArea"]')
        for (const region of regions) {
          const root = region.parentElement
          if (!root) continue
          const nav = directChild(root, 'panelList')
          if (!nav) continue
          const foot = directChild(root, 'footArea')
          nodes.root = root
          nodes.nav = nav
          nodes.region = region
          nodes.foot = foot
          nodes.actions = directChild(foot, 'footerActions')
          nodes.settings = directChild(foot, 'settingsArea')
          return true
        }
        return false
      }
      const connected = () => !!(nodes.root && nodes.root.isConnected && nodes.nav && nodes.nav.isConnected)
      function rect(el) {
        if (!el || !el.isConnected) return null
        const box = el.getBoundingClientRect()
        return box && box.height >= 0 ? box : null
      }
      const heightOf = (el) => { const box = rect(el); return box ? Math.max(0, Math.round(box.height)) : 0 }
      const collapsed = () => {
        try {
          const root = nodes.root
          if (!root) return true
          if (/(^|\s)[^\s]*_collapsed(\s|$)/.test(String(root.className || ''))) return true
          const box = root.getBoundingClientRect()
          return !box || box.width < 40
        } catch (_) { return true }
      }

      // 入口区上限：让工作区至少剩 REGION_FLOOR。
      function navCap() {
        const nav = rect(nodes.nav)
        const anchor = rect(nodes.actions) || rect(nodes.foot) || rect(nodes.region)
        if (!nav || !anchor) return MAX_HEIGHT
        return Math.max(0, Math.min(MAX_HEIGHT, Math.round(anchor.top - nav.top - REGION_FLOOR)))
      }
      // 底部动作区上限：从 nav 下沿到 settingArea 上沿之间的空间，留出工作区下限。
      function footerCap() {
        const nav = rect(nodes.nav)
        const foot = rect(nodes.foot)
        const settingsH = heightOf(nodes.settings)
        if (!nav || !foot) return MAX_HEIGHT
        return Math.max(0, Math.min(MAX_HEIGHT, Math.round(foot.bottom - nav.bottom - settingsH - REGION_FLOOR)))
      }
      const clamp = (value, cap) => Math.max(0, Math.min(Math.round(value), cap))

      const NAV_KEYS = ['flex', 'height', 'max-height', 'min-height', 'overflow-y', 'overflow-x']
      const ACTION_KEYS = ['height', 'max-height', 'min-height', 'overflow-y', 'overflow-x']
      function clear(el, keys) { if (el) keys.forEach((key) => el.style.removeProperty(key)) }
      // 显式高度 + 内部竖滚。overflow-y:auto 会把 overflow-x 提升成 auto，
      // 任何略宽的子元素都会拉出横向滚动条，所以横向显式钉 hidden。
      function paint(el, keys, height) {
        if (!el) return
        if (height === null || height === undefined) { clear(el, keys); return }
        el.style.height = `${height}px`
        el.style.maxHeight = `${height}px`
        el.style.minHeight = '0'
        el.style.overflowY = 'auto'
        el.style.overflowX = 'hidden'
      }
      function applyNav() {
        const nav = nodes.nav
        if (!nav) return
        const value = snapshot.navHeight === null ? null : clamp(snapshot.navHeight, navCap())
        if (value === null) clear(nav, NAV_KEYS)
        else { nav.style.flex = '0 0 auto'; paint(nav, NAV_KEYS, value) }
      }
      function applyFooter() {
        const actions = nodes.actions
        if (!actions) return
        const value = snapshot.footerHeight === null ? null : clamp(snapshot.footerHeight, footerCap())
        paint(actions, ACTION_KEYS, value)
      }
      // 工作区永远 flex:1 吃余量：中间不留白、横条双向可推可拉的几何前提。
      function applyRegion() {
        const region = nodes.region
        if (!region) return
        region.style.flex = '1 1 auto'
        region.style.minHeight = '0'
        region.style.overflowX = 'hidden'
        if (nodes.root) nodes.root.style.overflowX = 'hidden'
      }
      function apply() {
        if (disposed) return
        if (!connected() && !findNodes()) return
        applyRegion()
        applyNav()
        applyFooter()
        schedule()
      }

      function schedule() {
        if (disposed) return
        cancelAnimationFrame(frameToken)
        frameToken = requestAnimationFrame(place)
        window.clearTimeout(timerToken)
        timerToken = window.setTimeout(place, 120)
      }
      function place() {
        if (disposed) return
        if (!connected() && !findNodes()) { grips.forEach((grip) => { grip.el.style.display = 'none' }); return }
        const hidden = collapsed()
        const nav = rect(nodes.nav)
        const actions = rect(nodes.actions)
        const root = rect(nodes.root)
        const left = nav ? nav.left : root ? root.left + 12 : 0
        const width = nav ? nav.width : root ? Math.max(0, root.width - 24) : 0
        if (!nav || !actions || width <= 0) { grips.forEach((grip) => { grip.el.style.display = 'none' }); return }
        // 手柄 1 骑在入口区下沿；手柄 2 骑在底部动作区上沿。拖拽中不重排，避免抢回光标位置。
        const put = (grip, top) => {
          if (grip.el.dataset.dragging === 'true') return
          grip.boundary = top
          grip.el.style.top = `${Math.round(top - 4)}px`
          grip.el.style.left = `${Math.round(left)}px`
          grip.el.style.width = `${Math.round(width)}px`
          grip.el.style.display = hidden ? 'none' : 'flex'
        }
        put(grips[0], nav.bottom)
        put(grips[1], actions.top)
      }

      /**
       * direction = +1：横条随「段变高」向下走（入口区下沿）。
       * direction = -1：横条随「段变高」向上走（底部动作区上沿）。
       * pointermove 里不读任何布局：用「实际生效高度」反推 top，所以横条与内容同帧跟手。
       */
      function createGrip({ index, label, direction, getCap, getValue, setValue }) {
        const el = document.createElement('button')
        el.type = 'button'
        el.className = 'dst-grip'
        el.setAttribute('aria-label', label)
        el.setAttribute('title', label)
        const grip = { el, boundary: 0 }
        let drag = null

        const readHeight = () => {
          const value = getValue()
          if (value !== null && value !== undefined) return value
          return direction > 0 ? heightOf(nodes.nav) : heightOf(nodes.actions)
        }
        const onMove = (event) => {
          if (!drag) return
          const next = Math.max(0, Math.min(drag.start + direction * (event.clientY - drag.y), drag.cap))
          setValue(next)
          // 由实际生效高度反推横条位置：到上下限时横条与内容一起停住。
          el.style.top = `${Math.round(drag.top + direction * (next - drag.start) - 4)}px`
        }
        const end = () => {
          if (!drag) return
          window.removeEventListener('pointermove', onMove)
          window.removeEventListener('pointerup', end)
          window.removeEventListener('pointercancel', end)
          delete el.dataset.dragging
          document.body.classList.remove('dst-resizing')
          drag = null
          schedule()
        }
        el.addEventListener('pointerdown', (event) => {
          if (event.button !== 0) return
          event.preventDefault()
          el.focus()
          drag = { y: event.clientY, start: readHeight(), cap: getCap(), top: parseFloat(el.style.top || '0') + 4 }
          el.dataset.dragging = 'true'
          el.setPointerCapture?.(event.pointerId)
          document.body.classList.add('dst-resizing')
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', end)
          window.addEventListener('pointercancel', end)
        })
        el.addEventListener('dblclick', () => { setValue(null); schedule() })
        el.addEventListener('keydown', (event) => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          if (event.key === 'Home' || event.key === 'End') { setValue(null); schedule(); return }
          // ArrowDown 永远表示向下推横条；底部横条因此是「减小」而不是「增大」。
          const delta = event.key === 'ArrowDown' ? 16 : -16
          setValue(Math.max(0, Math.min(readHeight() + direction * delta, getCap())))
          schedule()
        })
        document.body.append(el)
        return grip
      }

      // null = 交回宿主自动高度；0 和正数 = 用户指定的像素高度。
      function setNav(px) {
        const value = px === null || px === undefined ? null : clamp(px, navCap())
        publish({ ...snapshot, navHeight: value })
        applyNav()
        schedule()
        return value
      }
      function setFooter(px) {
        const value = px === null || px === undefined ? null : clamp(px, footerCap())
        publish({ ...snapshot, footerHeight: value })
        applyFooter()
        schedule()
        return value
      }
      function reset() {
        publish({ ...snapshot, navHeight: null, footerHeight: null })
        apply()
      }

      grips.push(createGrip({
        index: 0, direction: 1, label: '入口区高度',
        getCap: navCap, getValue: () => snapshot.navHeight, setValue: setNav,
      }))
      grips.push(createGrip({
        index: 1, direction: -1, label: '底部动作区高度',
        getCap: footerCap, getValue: () => snapshot.footerHeight, setValue: setFooter,
      }))
      apply()

      // 只盯两件事：节点增删（子树重挂）与 root 的 class（折叠/展开）。
      // 不盯 style：自己写的高度会反过来触发 observer。
      const structureObserver = new MutationObserver(() => {
        if (!connected()) {
          if (!findNodes()) return
          // 节点是此刻才挂载出来的：补挂 classObserver 与 ResizeObserver。
          observe()
          apply()
        } else {
          schedule()
        }
      })
      const classObserver = new MutationObserver(() => schedule())
      const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => schedule()) : null
      function observe() {
        try {
          classObserver.disconnect()
          if (nodes.root) classObserver.observe(nodes.root, { attributes: true, attributeFilter: ['class'] })
        } catch (_) {}
        if (!resizeObserver) return
        resizeObserver.disconnect()
        ;[nodes.root, nodes.nav, nodes.region, nodes.foot, nodes.actions].forEach((node) => {
          try { node && resizeObserver.observe(node) } catch (_) {}
        })
      }
      structureObserver.observe(document.body, { childList: true, subtree: true })
      observe()

      const onWindowResize = () => { schedule(); observe() }
      window.addEventListener('resize', onWindowResize)
      const offPrefs = subscribe(() => schedule())

      return {
        apply,
        setNav,
        setFooter,
        reset,
        measure() {
          const navAuto = snapshot.navHeight === null || snapshot.navHeight === undefined
          const footerAuto = snapshot.footerHeight === null || snapshot.footerHeight === undefined
          return {
            nav: navAuto ? heightOf(nodes.nav) : clamp(snapshot.navHeight, navCap()),
            footer: footerAuto ? heightOf(nodes.actions) : clamp(snapshot.footerHeight, footerCap()),
            navAuto,
            footerAuto,
          }
        },
        dispose() {
          disposed = true
          cancelAnimationFrame(frameToken)
          window.clearTimeout(timerToken)
          structureObserver.disconnect()
          classObserver.disconnect()
          resizeObserver?.disconnect()
          window.removeEventListener('resize', onWindowResize)
          offPrefs()
          grips.forEach((grip) => { try { grip.el.remove() } catch (_) {} })
          grips.length = 0
          clear(nodes.nav, NAV_KEYS)
          clear(nodes.actions, ACTION_KEYS)
          if (nodes.region) { nodes.region.style.removeProperty('flex'); nodes.region.style.removeProperty('min-height'); nodes.region.style.removeProperty('overflow-x') }
          if (nodes.root) nodes.root.style.removeProperty('overflow-x')
          document.body.classList.remove('dst-resizing')
        },
      }
    }

    /* ------------------------------------------------------------- 装配 */

    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, DICTS), 'sidebar-tuner: locale')
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.pluginCss = 'dsh-sidebar-tuner/styles'
        style.textContent = CSS
        document.head.append(style)
        return () => style.remove()
      }, 'sidebar-tuner: styles')
      ctx.effect(() => attachPins(ctx), 'sidebar-tuner: entry visibility')
      ctx.effect(() => {
        resizeHandle = installResize()
        return () => { resizeHandle?.dispose(); resizeHandle = null }
      }, 'sidebar-tuner: region resize')
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => t('panel.label'), locale: NS }, EntryGlyph))
      ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, makePanel(ctx, t)))
      try {
        ctx.slots.inject('sidebar.panellist.actions', () => ctx.slots.register({ name: 'sidebar.panellist.actions', id: PANEL_ID, order: 0, locale: NS }, makeMenu(ctx, t)))
      } catch (_) {}
      ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: PANEL_ID, order: 25, label: () => t('settings.label'), locale: NS }, makePanel(ctx, t, 'settings')))
    }
    return { name: 'sidebar-tuner', inject: ['slots', 'locale', 'layout'], apply }
  },
})
