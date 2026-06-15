import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { MessageSquare, Search, X, FileJson, Menu, ChevronRight, ChevronLeft, Wrench, Copy, Upload, Play, ThumbsUp, ThumbsDown, RotateCcw, Pencil, Folder, FileText, User, Sparkles, BookOpen, ArrowLeft, Plus, Star, Trash2 } from 'lucide-react';

// ============================================================
// localStorage hook
// ============================================================

function useLocalStorage(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }, [key, value]);

  return [value, setValue];
}

// 长按 hook:手机长按 / 桌面右键 都触发 callback,callback 接收一个 {x,y} 位置
function useLongPress(callback, { ms = 450 } = {}) {
  const timerRef = useRef(null);
  const triggeredRef = useRef(false);
  const startPosRef = useRef(null);

  const start = useCallback((e) => {
    triggeredRef.current = false;
    const touch = e.touches?.[0];
    const x = touch ? touch.clientX : e.clientX;
    const y = touch ? touch.clientY : e.clientY;
    startPosRef.current = { x, y };
    timerRef.current = setTimeout(() => {
      triggeredRef.current = true;
      callback({ x, y });
    }, ms);
  }, [callback, ms]);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const move = useCallback((e) => {
    if (!startPosRef.current) return;
    const touch = e.touches?.[0];
    const x = touch ? touch.clientX : e.clientX;
    const y = touch ? touch.clientY : e.clientY;
    const dx = x - startPosRef.current.x;
    const dy = y - startPosRef.current.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clear();
  }, [clear]);

  return {
    triggeredRef,
    handlers: {
      onTouchStart: start,
      onTouchEnd: clear,
      onTouchCancel: clear,
      onTouchMove: move,
      onMouseDown: start,
      onMouseUp: clear,
      onMouseLeave: clear,
      onMouseMove: move,
      onContextMenu: (e) => {
        e.preventDefault();
        callback({ x: e.clientX, y: e.clientY });
      },
    },
  };
}

// ============================================================
// 解析器集合
// ============================================================

function parseConversations(data) {
  const list = Array.isArray(data) ? data : (data?.conversations || []);
  return list
    .map(c => ({
      uuid: c.uuid || c.id || crypto.randomUUID(),
      name: c.name || c.title || '未命名对话',
      summary: c.summary || c.description || c.snippet || null,
      project_uuid: c.project_uuid || c.project_id || c.project?.uuid || null,
      _candidates: extractUuidFields(c),
      created_at: c.created_at || c.createdAt || null,
      updated_at: c.updated_at || c.updatedAt || c.created_at || null,
      messages: extractMessages(c),
    }))
    .filter(c => c.messages.length > 0)
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
}

function isUuidLike(s) {
  return typeof s === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

function extractUuidFields(obj) {
  // 收集 conversation 对象顶层所有 string 值是 UUID 的字段
  // 也支持嵌套一层的 {field: {uuid: '...'}} 结构
  const result = {};
  if (!obj || typeof obj !== 'object') return result;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && isUuidLike(value)) {
      result[key] = value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (typeof value.uuid === 'string' && isUuidLike(value.uuid)) {
        result[`${key}.uuid`] = value.uuid;
      }
    }
  }
  return result;
}

function extractMessages(conv) {
  const raw = conv.chat_messages || conv.messages || [];
  return raw.map(m => ({
    uuid: m.uuid || m.id || crypto.randomUUID(),
    role: normalizeRole(m.sender || m.role),
    blocks: extractBlocks(m),
    model: extractModel(m),
    created_at: m.created_at || m.createdAt || null,
  }));
}

function normalizeRole(s) {
  if (!s) return 'assistant';
  const v = String(s).toLowerCase();
  if (v === 'human' || v === 'user') return 'human';
  return 'assistant';
}

function extractBlocks(m) {
  const blocks = [];
  if (Array.isArray(m.content)) {
    for (const b of m.content) {
      if (typeof b === 'string') {
        blocks.push({ type: 'text', text: b });
        continue;
      }
      const t = b?.type;
      if (t === 'text' || !t) {
        if (b.text) blocks.push({ type: 'text', text: b.text });
      } else if (t === 'tool_use') {
        blocks.push({ type: 'tool_use', name: b.name || '未知工具', input: b.input || {}, id: b.id });
      } else if (t === 'tool_result') {
        let resultText = '';
        if (typeof b.content === 'string') resultText = b.content;
        else if (Array.isArray(b.content)) {
          resultText = b.content.map(x => (typeof x === 'string' ? x : (x.text || ''))).join('\n');
        }
        blocks.push({ type: 'tool_result', text: resultText, tool_use_id: b.tool_use_id, is_error: b.is_error });
      } else if (t === 'thinking') {
        blocks.push({ type: 'thinking', text: b.thinking || b.text || '', summary: b.summary || null });
      } else if (t === 'image') {
        blocks.push({ type: 'image', source: b.source });
      } else {
        blocks.push({ type: 'unknown', raw: t });
      }
    }
  } else if (m.text) {
    blocks.push({ type: 'text', text: m.text });
  } else if (typeof m.content === 'string') {
    blocks.push({ type: 'text', text: m.content });
  }
  return blocks;
}

function extractModel(m) {
  return m.model || m.metadata?.model || m.metadata?.model_slug || null;
}

function parseMemories(data) {
  // memories.json 是一个数组,通常只有一项
  const item = Array.isArray(data) ? data[0] : data;
  if (!item) return null;
  return {
    accountUuid: item.account_uuid || null,
    conversationsMemory: item.conversations_memory || '',
    projectMemories: item.project_memories || {},  // dict: projectUuid -> markdown string
  };
}

function parseUsers(data) {
  const item = Array.isArray(data) ? data[0] : data;
  if (!item) return null;
  return {
    uuid: item.uuid,
    name: item.full_name || item.name || '账号',
    email: item.email_address || item.email || null,
    phone: item.verified_phone_number || null,
  };
}

function parseProject(data) {
  if (!data || !data.uuid) return null;
  return {
    uuid: data.uuid,
    name: data.name || '未命名项目',
    description: data.description || '',
    isPrivate: data.is_private,
    isStarter: data.is_starter_project,
    promptTemplate: data.prompt_template || '',
    createdAt: data.created_at || null,
    updatedAt: data.updated_at || null,
    creator: data.creator ? (data.creator.full_name || data.creator.name) : null,
    docs: (data.docs || [])
      .map(d => ({
        uuid: d.uuid || crypto.randomUUID(),
        filename: d.filename || '',
        content: d.content || '',
        createdAt: d.created_at || null,
      }))
      .sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)),
  };
}

// 判断一个 json 文件该走哪个解析器(基于文件名和内容)
function classifyFile(name, data) {
  const lower = name.toLowerCase();
  const basename = lower.split('/').pop();
  if (basename === 'memories.json') return 'memories';
  if (basename === 'users.json') return 'users';
  if (basename === 'conversations.json') return 'conversations';

  // UUID 命名的文件:基本是 project
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i.test(basename)) {
    return 'project';
  }

  // 兜底:看内容形状
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if ('docs' in data && 'uuid' in data) return 'project';
    if ('conversations_memory' in data || 'project_memories' in data) return 'memories';
  }
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first && typeof first === 'object') {
      if ('full_name' in first || 'email_address' in first) return 'users';
      if ('conversations_memory' in first || 'project_memories' in first) return 'memories';
      if ('chat_messages' in first || 'messages' in first || 'name' in first) return 'conversations';
    }
  }
  return 'unknown';
}

// ============================================================
// ZIP 解压(用浏览器原生 DecompressionStream,不依赖外部库)
// 从末尾的 End of Central Directory 读元数据,精确定位每个文件
// ============================================================

async function unzipFile(file) {
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const decoder = new TextDecoder('utf-8');
  const files = [];

  // 1. 找 EOCD (End of Central Directory) signature: 0x06054b50
  //    从末尾向前扫,EOCD 至少 22 字节,后面可能有最多 65535 字节的 zip comment
  const EOCD_SIG = 0x06054b50;
  const minSize = 22;
  const maxCommentLen = 65535;
  const startScan = Math.max(0, bytes.length - minSize - maxCommentLen);
  let eocdPos = -1;
  for (let i = bytes.length - minSize; i >= startScan; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) {
    throw new Error('不是有效的 zip 文件(找不到 EOCD)');
  }

  // 2. 从 EOCD 读 Central Directory 的位置
  const totalEntries = view.getUint16(eocdPos + 10, true);
  let centralDirOffset = view.getUint32(eocdPos + 16, true);

  // 处理 ZIP64(如果 offset 是 0xFFFFFFFF 表示用 ZIP64,这种情况下导出文件不太可能出现)
  if (centralDirOffset === 0xFFFFFFFF) {
    throw new Error('ZIP64 格式暂不支持');
  }

  // 3. 解析 Central Directory 拿到每个文件的精确元数据
  const CENTRAL_SIG = 0x02014b50;
  const entries = [];
  let pos = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > bytes.length) break;
    if (view.getUint32(pos, true) !== CENTRAL_SIG) break;

    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);

    const filename = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));

    entries.push({ filename, compressionMethod, compressedSize, localHeaderOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }

  // 4. 对每个 entry 跳到 Local File Header 读真实数据
  const LOCAL_SIG = 0x04034b50;
  for (const entry of entries) {
    if (entry.filename.endsWith('/')) continue;
    if (!entry.filename.toLowerCase().endsWith('.json')) continue;

    const lh = entry.localHeaderOffset;
    if (lh + 30 > bytes.length) continue;
    if (view.getUint32(lh, true) !== LOCAL_SIG) continue;

    const lhNameLen = view.getUint16(lh + 26, true);
    const lhExtraLen = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + lhNameLen + lhExtraLen;
    const compressedData = bytes.subarray(dataStart, dataStart + entry.compressedSize);

    let fileData;
    if (entry.compressionMethod === 0) {
      // STORE,不压缩
      fileData = compressedData;
    } else if (entry.compressionMethod === 8) {
      // DEFLATE
      try {
        const stream = new Response(compressedData).body.pipeThrough(
          new DecompressionStream('deflate-raw')
        );
        const decompressed = await new Response(stream).arrayBuffer();
        fileData = new Uint8Array(decompressed);
      } catch (e) {
        console.error('解压失败:', entry.filename, e);
        continue;
      }
    } else {
      // 不支持的压缩方法
      continue;
    }

    const blob = new Blob([fileData]);
    files.push(new File([blob], entry.filename, { type: 'application/json' }));
  }

  return files;
}

// 把混合输入(可能含 zip)展开成纯 File 列表
async function expandFiles(fileList) {
  const out = [];
  for (const f of Array.from(fileList)) {
    if (f.name.toLowerCase().endsWith('.zip')) {
      try {
        const extracted = await unzipFile(f);
        out.push(...extracted);
      } catch (e) {
        console.error('zip 解压失败:', f.name, e);
      }
    } else {
      out.push(f);
    }
  }
  return out;
}

function summarizeThinking(text) {
  if (!text) return '';
  const trimmed = text.trim();
  const firstPara = trimmed.split(/\n\n+/)[0];
  const firstLine = firstPara.split('\n')[0];
  const m = firstLine.match(/^(.+?[。?!.?!])/);
  let summary = m ? m[1] : firstLine;
  if (summary.length > 80) summary = summary.slice(0, 80) + '…';
  return summary;
}

function getOverallSummary(items) {
  for (const it of items) {
    if (it.type === 'thinking') {
      const s = it.summary || summarizeThinking(it.text);
      if (s) return s;
    }
  }
  const toolCount = items.filter(i => i.type === 'tool_use').length;
  if (toolCount > 0) return `使用了 ${toolCount} 个工具`;
  return '思考过程';
}

function DashedClock({ size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.7"
         strokeLinecap="round" strokeLinejoin="round"
         style={{ flexShrink: 0 }}>
      <path d="M 17.5 5 A 9 9 0 1 1 6.5 5" />
      <path d="M 6.5 5 A 9 9 0 0 1 17.5 5" strokeDasharray="0.4 2.2" />
      <polyline points="12,8 12,12 15,13.5" />
    </svg>
  );
}

// ============================================================
// markdown
// ============================================================

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderMarkdown(text) {
  if (!text) return '';
  let html = text;
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre class="code-block"><code>${escapeHtml(code.trimEnd())}</code></pre>`;
  });
  const blocks = html.split(/\n\n+/);
  const out = blocks.map(block => {
    if (block.startsWith('<pre')) return block;
    if (/^#{1,6}\s/.test(block)) {
      const m = block.match(/^(#{1,6})\s+(.+)/);
      const level = m[1].length;
      return `<h${level}>${inline(m[2])}</h${level}>`;
    }
    if (/^[-*]\s/m.test(block)) {
      const items = block.split('\n').filter(l => /^[-*]\s/.test(l))
        .map(l => `<li>${inline(l.replace(/^[-*]\s+/, ''))}</li>`).join('');
      return `<ul>${items}</ul>`;
    }
    if (/^\d+\.\s/m.test(block)) {
      const items = block.split('\n').filter(l => /^\d+\.\s/.test(l))
        .map(l => `<li>${inline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('');
      return `<ol>${items}</ol>`;
    }
    if (/^>\s/.test(block)) {
      const content = block.split('\n').map(l => l.replace(/^>\s?/, '')).join('<br/>');
      return `<blockquote>${inline(content)}</blockquote>`;
    }
    return `<p>${inline(block).replace(/\n/g, '<br/>')}</p>`;
  });
  return out.join('\n');
}

function inline(s) {
  let r = escapeHtml(s);
  r = r.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');
  r = r.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  r = r.replace(/(?<!\*)\*([^\*\n]+)\*(?!\*)/g, '<em>$1</em>');
  r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return r;
}

function formatDate(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  const pad = n => String(n).padStart(2, '0');
  if (sameYear) return `${months[d.getMonth()]}${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getFullYear()}年${months[d.getMonth()]}${d.getDate()}日`;
}

function formatDateShort(s) {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d)) return '';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const months = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
  if (sameYear) return `${months[d.getMonth()]}${d.getDate()}日`;
  return `${d.getFullYear()}年${months[d.getMonth()]}${d.getDate()}日`;
}

function shortModel(m) {
  if (!m) return null;
  return m.replace(/^claude-/, 'Claude ').replace(/^anthropic\//, '')
    .replace(/-20\d{6}$/, '').replace(/-/g, ' ');
}

function safeJson(v) {
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

// ============================================================
// 文件读取:支持多文件 + 拖文件夹
// ============================================================

async function readEntries(entries) {
  // FileSystemEntry[] -> File[]
  const files = [];
  const walk = async (entry) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      while (true) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        all.push(...batch);
      }
      for (const e of all) await walk(e);
    }
  };
  for (const e of entries) await walk(e);
  return files;
}

async function filesFromDataTransfer(dt) {
  const items = Array.from(dt.items || []);
  const entries = items
    .map(it => it.webkitGetAsEntry ? it.webkitGetAsEntry() : null)
    .filter(Boolean);
  if (entries.length) return await readEntries(entries);
  return Array.from(dt.files || []);
}

async function processFiles(fileList) {
  // 返回 {conversations, memories, user, projects}
  const files = Array.from(fileList).filter(f => f.name.endsWith('.json'));
  const result = {
    conversations: null,
    memories: null,
    user: null,
    projects: [],
    errors: [],
    detectedField: null,
    detectedHits: 0,
  };

  for (const f of files) {
    try {
      const text = await f.text();
      const data = JSON.parse(text);
      const kind = classifyFile(f.name, data);

      if (kind === 'conversations') {
        result.conversations = parseConversations(data);
      } else if (kind === 'memories') {
        result.memories = parseMemories(data);
      } else if (kind === 'users') {
        result.user = parseUsers(data);
      } else if (kind === 'project') {
        const p = parseProject(data);
        if (p) result.projects.push(p);
      }
    } catch (e) {
      result.errors.push(`${f.name}: ${e.message}`);
    }
  }

  // 项目按更新时间倒序
  result.projects.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

  // 自动探测项目关联字段:扫每条对话的 _candidates,看哪个字段命中项目 UUID 最多
  if (result.conversations && result.conversations.length > 0 && result.projects.length > 0) {
    const projectUuidSet = new Set(result.projects.map(p => p.uuid));
    const fieldCounts = {};
    // 采样前 500 条够了
    const sample = result.conversations.slice(0, 500);
    for (const c of sample) {
      const cands = c._candidates || {};
      for (const [field, uuid] of Object.entries(cands)) {
        if (projectUuidSet.has(uuid)) {
          fieldCounts[field] = (fieldCounts[field] || 0) + 1;
        }
      }
    }
    const sorted = Object.entries(fieldCounts).sort(([, a], [, b]) => b - a);
    if (sorted.length > 0) {
      const [bestField, hits] = sorted[0];
      result.detectedField = bestField;
      // 全量重新归类(不只是 sample)
      let totalHits = 0;
      for (const c of result.conversations) {
        const candidate = c._candidates?.[bestField];
        if (candidate && projectUuidSet.has(candidate)) {
          c.project_uuid = candidate;
          totalHits++;
        }
      }
      result.detectedHits = totalHits;
    }
  }

  // 清理 _candidates,避免数据膨胀
  if (result.conversations) {
    for (const c of result.conversations) delete c._candidates;
  }

  return result;
}

// ============================================================
// 主组件
// ============================================================

export default function Archive() {
  const [data, setData] = useState(null); // {conversations, memories, user, projects}
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastErrors, setLastErrors] = useState([]);
  const [dragOver, setDragOver] = useState(false);

  const [search, setSearch] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // 主视图状态:{kind:'conv'|'memory'|'project'|'doc'|'projects-list', ...}
  const [view, setView] = useState(null);

  // 手动归类:{ convUuid: projectUuid },localStorage 持久化
  const [manualMap, setManualMap] = useLocalStorage('archive:manualProjectMap', {});

  // 置顶:{ convUuid: true },localStorage 持久化
  const [starredMap, setStarredMap] = useLocalStorage('archive:starredMap', {});

  // 本地重命名:{ convUuid: newName },localStorage 持久化
  const [renamedMap, setRenamedMap] = useLocalStorage('archive:renamedMap', {});

  // 本地隐藏:{ convUuid: true },localStorage 持久化
  const [hiddenMap, setHiddenMap] = useLocalStorage('archive:hiddenMap', {});

  // 归类操作
  const assignConvToProject = useCallback((convUuid, projectUuid) => {
    setManualMap(m => ({ ...m, [convUuid]: projectUuid }));
  }, [setManualMap]);

  const removeConvFromProject = useCallback((convUuid) => {
    setManualMap(m => {
      const next = { ...m };
      delete next[convUuid];
      return next;
    });
  }, [setManualMap]);

  const toggleStar = useCallback((convUuid) => {
    setStarredMap(m => {
      const next = { ...m };
      if (next[convUuid]) delete next[convUuid];
      else next[convUuid] = true;
      return next;
    });
  }, [setStarredMap]);

  const renameConv = useCallback((convUuid, newName) => {
    setRenamedMap(m => ({ ...m, [convUuid]: newName }));
  }, [setRenamedMap]);

  const hideConv = useCallback((convUuid) => {
    setHiddenMap(m => ({ ...m, [convUuid]: true }));
  }, [setHiddenMap]);

  // 对话项操作菜单 (漂浮卡片): { uuid, x, y }
  const [convMenu, setConvMenu] = useState(null);
  // 项目选择 sheet 控制
  const [pickerForConv, setPickerForConv] = useState(null);
  // 重命名 sheet
  const [renameForConv, setRenameForConv] = useState(null);
  // 删除确认 sheet
  const [deleteForConv, setDeleteForConv] = useState(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const handleFiles = useCallback(async (files) => {
    setLoading(true);
    setError(null);
    setLastErrors([]);
    try {
      // 先把 zip 文件解压成 File 列表
      const expanded = await expandFiles(files);
      const result = await processFiles(expanded);
      if (result.errors && result.errors.length > 0) {
        setLastErrors(result.errors);
      }
      if (!result.conversations && result.projects.length === 0 && !result.memories && !result.user) {
        setError('没识别出任何档案文件——确认你传的是 Claude 导出包(整个 zip 或者解压后的 json 文件)。');
        return;
      }

      // 合并:新文件覆盖同类旧数据,这次没传的部分保留之前的
      setData(prev => {
        const projectMap = new Map();
        for (const p of (prev?.projects || [])) projectMap.set(p.uuid, p);
        for (const p of result.projects) projectMap.set(p.uuid, p);
        const projects = [...projectMap.values()]
          .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

        return {
          conversations: result.conversations || prev?.conversations || null,
          memories: result.memories || prev?.memories || null,
          user: result.user || prev?.user || null,
          projects,
          detectedField: result.detectedField || prev?.detectedField || null,
          detectedHits: result.detectedHits || prev?.detectedHits || 0,
        };
      });

      // view 只在首次(currentView 为空)时设默认值
      setView(currentView => {
        if (currentView) return currentView;
        if (result.conversations && result.conversations.length > 0) {
          return { kind: 'conv', id: result.conversations[0].uuid };
        }
        if (result.projects.length > 0) {
          return { kind: 'projects-list' };
        }
        if (result.memories) {
          return { kind: 'memory' };
        }
        return null;
      });
    } catch (e) {
      setError(`处理失败:${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const onDrop = useCallback(async (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = await filesFromDataTransfer(e.dataTransfer);
    if (files.length) handleFiles(files);
  }, [handleFiles]);

  const onFileInput = useCallback((e) => {
    if (e.target.files && e.target.files.length) {
      handleFiles(e.target.files);
    }
  }, [handleFiles]);

  const conversations = data?.conversations || [];
  const projects = data?.projects || [];
  const memories = data?.memories || null;
  const user = data?.user || null;

  const filtered = useMemo(() => {
    let list = conversations.filter(c => !hiddenMap[c.uuid]);
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(c => {
      const displayName = renamedMap[c.uuid] || c.name;
      if (displayName.toLowerCase().includes(q)) return true;
      return c.messages.some(m =>
        m.blocks.some(b => b.text && b.text.toLowerCase().includes(q))
      );
    });
  }, [conversations, search, hiddenMap, renamedMap]);

  const navigate = useCallback((v) => {
    setView(v);
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // ===== 空状态(上传界面) =====
  if (!data) {
    return (
      <>
        <Styles />
        <div className="archive-root archive-empty">
          <div className="empty-inner">
            <div className="empty-mark">ARCHIVE</div>
            <h1 className="empty-title">Claude 对话档案</h1>
            <p className="empty-sub">把 Anthropic 给你的导出 zip 直接拖进来——一步搞定。或者解压后的文件夹/json 也行,前端本地解析,文件不会离开你的设备。</p>
            <label
              className={`drop-zone ${dragOver ? 'drag-over' : ''} ${loading ? 'loading' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <input
                type="file"
                accept=".json,.zip,application/json,application/zip"
                multiple
                style={{ display: 'none' }}
                onChange={onFileInput}
              />
              <FileJson size={36} strokeWidth={1.2} />
              <div className="drop-text">
                {loading ? '解析中…' : '拖入 zip 或者点击选文件'}
              </div>
              <div className="drop-hint">Claude → Settings → Privacy → Export Data</div>
            </label>
            {error && <div className="error-box">{error}</div>}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Styles />
      <div className="archive-root">
        {isMobile && sidebarOpen && (
          <div className="sidebar-mask" onClick={() => setSidebarOpen(false)} />
        )}

        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div className="sidebar-head">
            <div className="brand">ARCHIVE</div>
            <div className="sidebar-head-actions">
              <label className="icon-btn" title="追加上传">
                <input
                  type="file"
                  accept=".json,.zip,application/json,application/zip"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length) {
                      handleFiles(e.target.files);
                      e.target.value = ''; // 允许重复选同一个文件
                    }
                  }}
                />
                <Plus size={15} strokeWidth={2} />
              </label>
              <button className="icon-btn" title="清空重新上传"
                onClick={() => { setData(null); setView(null); }}>
                <X size={16} />
              </button>
            </div>
          </div>

          {user && (
            <button
              className="account-card"
              title={user.email || ''}
            >
              <div className="account-avatar">
                {user.name ? user.name.charAt(0).toUpperCase() : <User size={14} />}
              </div>
              <div className="account-info">
                <div className="account-name">{user.name}</div>
                {user.email && <div className="account-email">{user.email}</div>}
              </div>
            </button>
          )}

          {(projects.length > 0 || conversations.length > 0 || memories || user) && (
            <div className="status-bar">
              <span className={projects.length ? '' : 'sb-faint'}>项目 {projects.length}</span>
              <span className="sb-sep">·</span>
              <span className={conversations.length ? '' : 'sb-faint'}>对话 {conversations.length}</span>
              {memories && <><span className="sb-sep">·</span><span>记忆</span></>}
              {data?.detectedHits > 0 && (
                <><span className="sb-sep">·</span><span>已归类 {data.detectedHits}</span></>
              )}
            </div>
          )}

          {lastErrors.length > 0 && (
            <div className="error-banner">
              <div className="error-banner-head">
                <span>{lastErrors.length} 个文件没解析成功</span>
                <button className="error-banner-close" onClick={() => setLastErrors([])}>
                  <X size={12} />
                </button>
              </div>
              <ul>
                {lastErrors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}
                {lastErrors.length > 5 && <li className="error-banner-more">… 还有 {lastErrors.length - 5} 个</li>}
              </ul>
            </div>
          )}

          <div className="nav-group">
            {conversations.length > 0 && (
              <button
                className={`nav-row ${view?.kind === 'conv' ? 'active' : ''}`}
                onClick={() => navigate({ kind: 'conv', id: conversations[0].uuid })}
              >
                <MessageSquare size={15} strokeWidth={1.8} />
                <span>Chats</span>
              </button>
            )}
            {projects.length > 0 && (
              <button
                className={`nav-row ${view?.kind === 'projects-list' || view?.kind === 'project' || view?.kind === 'doc' ? 'active' : ''}`}
                onClick={() => navigate({ kind: 'projects-list' })}
              >
                <Folder size={15} strokeWidth={1.8} />
                <span>Projects</span>
                <span className="nav-count">{projects.length}</span>
              </button>
            )}
            {memories && (
              <button
                className={`nav-row ${view?.kind === 'memory' ? 'active' : ''}`}
                onClick={() => navigate({ kind: 'memory' })}
              >
                <BookOpen size={15} strokeWidth={1.8} />
                <span>Memory</span>
              </button>
            )}
          </div>

          <div className="search-row">
            <Search size={14} strokeWidth={1.8} />
            <input type="text" placeholder="搜索对话"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="sidebar-scroll">
            {conversations.length > 0 && (() => {
              const starredConvs = filtered.filter(c => starredMap[c.uuid]);
              const otherConvs = filtered.filter(c => !starredMap[c.uuid]);
              return (
                <>
                  {starredConvs.length > 0 && (
                    <div className="sb-section">
                      <div className="sb-section-head">
                        <span className="sb-section-title">置顶</span>
                      </div>
                      <div className="conv-list">
                        {starredConvs.map(c => (
                          <ConvItem
                            key={c.uuid}
                            conv={c}
                            displayName={renamedMap[c.uuid] || c.name}
                            starred
                            active={view?.kind === 'conv' && view.id === c.uuid}
                            onClick={() => navigate({ kind: 'conv', id: c.uuid })}
                            onLongPress={(pos) => setConvMenu({ uuid: c.uuid, ...pos })}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="conv-list">
                    {otherConvs.map(c => (
                      <ConvItem
                        key={c.uuid}
                        conv={c}
                        displayName={renamedMap[c.uuid] || c.name}
                        starred={false}
                        active={view?.kind === 'conv' && view.id === c.uuid}
                        onClick={() => navigate({ kind: 'conv', id: c.uuid })}
                        onLongPress={(pos) => setConvMenu({ uuid: c.uuid, ...pos })}
                      />
                    ))}
                    {filtered.length === 0 && search && (
                      <div className="no-result">没找到匹配的对话</div>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </aside>

        <main className="main">
          <div className="mobile-bar">
            <button className="icon-btn" onClick={() => setSidebarOpen(true)}>
              <Menu size={18} />
            </button>
            <div className="mobile-title">{getViewTitle(view, data, renamedMap)}</div>
            <div style={{ width: 28 }} />
          </div>
          <MainView
            view={view}
            data={data}
            navigate={navigate}
            manualMap={manualMap}
            renamedMap={renamedMap}
            onOpenPicker={(convUuid) => setPickerForConv(convUuid)}
            onRemoveFromProject={removeConvFromProject}
          />
        </main>
      </div>

      {convMenu && (() => {
        const c = conversations.find(x => x.uuid === convMenu.uuid);
        if (!c) return null;
        return (
          <ConvContextMenu
            anchor={{ x: convMenu.x, y: convMenu.y }}
            isStarred={!!starredMap[convMenu.uuid]}
            isInProject={!!manualMap[convMenu.uuid]}
            onClose={() => setConvMenu(null)}
            onChangeProject={() => {
              const uuid = convMenu.uuid;
              setConvMenu(null);
              setPickerForConv(uuid);
            }}
            onToggleStar={() => {
              toggleStar(convMenu.uuid);
              setConvMenu(null);
            }}
            onRename={() => {
              const uuid = convMenu.uuid;
              setConvMenu(null);
              setRenameForConv(uuid);
            }}
            onDelete={() => {
              const uuid = convMenu.uuid;
              setConvMenu(null);
              setDeleteForConv(uuid);
            }}
          />
        );
      })()}

      {renameForConv && (() => {
        const c = conversations.find(x => x.uuid === renameForConv);
        if (!c) return null;
        const current = renamedMap[renameForConv] || c.name;
        return (
          <RenameSheet
            initialValue={current}
            onClose={() => setRenameForConv(null)}
            onConfirm={(name) => {
              renameConv(renameForConv, name);
              setRenameForConv(null);
            }}
          />
        );
      })()}

      {deleteForConv && (() => {
        const c = conversations.find(x => x.uuid === deleteForConv);
        if (!c) return null;
        const displayName = renamedMap[deleteForConv] || c.name;
        return (
          <DeleteConfirmSheet
            convName={displayName}
            onClose={() => setDeleteForConv(null)}
            onConfirm={() => {
              hideConv(deleteForConv);
              if (view?.kind === 'conv' && view.id === deleteForConv) {
                setView(null);
              }
              setDeleteForConv(null);
            }}
          />
        );
      })()}

      {pickerForConv && (
        <ProjectPickerSheet
          convUuid={pickerForConv}
          currentProjectUuid={manualMap[pickerForConv] || null}
          projects={projects}
          onClose={() => setPickerForConv(null)}
          onSelect={(projectUuid) => {
            assignConvToProject(pickerForConv, projectUuid);
            setPickerForConv(null);
          }}
          onClear={() => {
            removeConvFromProject(pickerForConv);
            setPickerForConv(null);
          }}
        />
      )}
    </>
  );
}

function getViewTitle(view, data, renamedMap) {
  if (!view) return 'archive';
  if (view.kind === 'memory') return '记忆';
  if (view.kind === 'projects-list') return '项目';
  const allConvs = data.conversations || [];
  const allProjects = data.projects || [];
  if (view.kind === 'conv') {
    const c = allConvs.find(x => x.uuid === view.id);
    if (!c) return 'archive';
    return renamedMap?.[c.uuid] || c.name;
  }
  if (view.kind === 'project') {
    const p = allProjects.find(x => x.uuid === view.id);
    return p ? (p.name || '未命名项目') : 'archive';
  }
  if (view.kind === 'doc') {
    const p = allProjects.find(x => x.uuid === view.projectId);
    const d = p?.docs.find(x => x.uuid === view.docId);
    return d ? (d.filename || '(无标题)') : 'archive';
  }
  return 'archive';
}

function MainView({ view, data, navigate, manualMap, renamedMap, onOpenPicker, onRemoveFromProject }) {
  if (!view) return <EmptyMain />;
  const allConvs = data.conversations || [];
  const allProjects = data.projects || [];

  if (view.kind === 'conv') {
    const c = allConvs.find(x => x.uuid === view.id);
    if (!c) return <EmptyMain />;
    return <ConversationView conv={c} displayName={renamedMap?.[c.uuid] || c.name} />;
  }

  if (view.kind === 'memory') {
    return <MemoryView memories={data.memories} projects={allProjects} navigate={navigate} />;
  }

  if (view.kind === 'projects-list') {
    return <ProjectsListView projects={allProjects} navigate={navigate} />;
  }

  if (view.kind === 'project') {
    const p = allProjects.find(x => x.uuid === view.id);
    if (!p) return <EmptyMain />;
    const convs = allConvs.filter(c =>
      c.project_uuid === p.uuid || manualMap?.[c.uuid] === p.uuid
    );
    const projectMemory = data.memories?.projectMemories?.[p.uuid] || null;
    return (
      <ProjectView
        project={p}
        conversations={convs}
        renamedMap={renamedMap}
        memory={projectMemory}
        navigate={navigate}
        onRemoveConv={onRemoveFromProject}
      />
    );
  }

  if (view.kind === 'doc') {
    const p = allProjects.find(x => x.uuid === view.projectId);
    const d = p?.docs.find(x => x.uuid === view.docId);
    if (!d) return <EmptyMain />;
    return <DocView doc={d} project={p} navigate={navigate} />;
  }

  return <EmptyMain />;
}

function EmptyMain() {
  return (
    <div className="main-empty">
      <MessageSquare size={28} strokeWidth={1.2} />
      <div>选一条对话开始阅读</div>
    </div>
  );
}

// ============================================================
// 记忆视图
// ============================================================

function MemoryView({ memories, projects, navigate }) {
  if (!memories) return <EmptyMain />;

  const hasMain = memories.conversationsMemory && memories.conversationsMemory.trim();
  const projectMems = Object.entries(memories.projectMemories || {})
    .filter(([, v]) => v && v.trim())
    .map(([uuid, content]) => {
      const proj = projects.find(p => p.uuid === uuid);
      return { uuid, content, name: proj?.name || uuid.slice(0, 8) };
    });

  return (
    <div className="conv-view">
      <header className="conv-header">
        <h1 className="conv-h1">记忆</h1>
        <p className="conv-summary-text">
          Claude 关于你的全部记忆——四段叙事的总记忆,以及每个项目自己的记忆段落。
        </p>
      </header>

      <div className="memory-body">
        {hasMain && (
          <section className="memory-section">
            <h2 className="memory-h2">总记忆</h2>
            <div className="memory-content"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(memories.conversationsMemory) }} />
          </section>
        )}

        {projectMems.length > 0 && (
          <section className="memory-section">
            <h2 className="memory-h2">项目记忆</h2>
            <div className="memory-project-list">
              {projectMems.map(pm => (
                <div key={pm.uuid} className="memory-project-block">
                  <button
                    className="memory-project-name"
                    onClick={() => navigate({ kind: 'project', id: pm.uuid })}
                  >
                    <Folder size={14} strokeWidth={1.8} />
                    <span>{pm.name}</span>
                    <ChevronRight size={14} />
                  </button>
                  <div className="memory-content memory-content-sm"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(pm.content) }} />
                </div>
              ))}
            </div>
          </section>
        )}

        {memories.accountUuid && (
          <section className="memory-section memory-meta-section">
            <div className="memory-meta">
              <span className="memory-meta-label">Account UUID</span>
              <code className="memory-meta-value">{memories.accountUuid}</code>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 项目视图
// ============================================================

function ProjectView({ project, conversations, renamedMap, memory, navigate }) {
  return (
    <div className="conv-view">
      <header className="conv-header">
        <h1 className="conv-h1">{project.name || '未命名项目'}</h1>
        {project.description && <p className="conv-summary-text">{project.description}</p>}
        <div className="conv-header-meta">
          <span>
            {formatDate(project.createdAt)}
            {project.updatedAt && project.updatedAt !== project.createdAt &&
              ` · 更新于 ${formatDate(project.updatedAt)}`}
          </span>
          <div className="model-chips">
            {project.isPrivate && <span className="model-chip">私有</span>}
            {project.isStarter && <span className="model-chip">入门项目</span>}
          </div>
        </div>
      </header>

      <div className="project-body">
        {memory && (
          <section className="project-section">
            <h2 className="project-h2">项目记忆</h2>
            <div className="memory-content memory-content-sm"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(memory) }} />
          </section>
        )}

        {project.promptTemplate && project.promptTemplate.trim() && (
          <section className="project-section">
            <h2 className="project-h2">项目指令</h2>
            <div className="prompt-template"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(project.promptTemplate) }} />
          </section>
        )}

        {conversations.length > 0 && (
          <section className="project-section">
            <h2 className="project-h2">对话 ({conversations.length})</h2>
            <div className="project-conv-list">
              {conversations.map(c => (
                <button
                  key={c.uuid}
                  className="project-conv-item"
                  onClick={() => navigate({ kind: 'conv', id: c.uuid })}
                >
                  <MessageSquare size={14} strokeWidth={1.8} />
                  <div className="project-conv-info">
                    <div className="project-conv-title">{renamedMap?.[c.uuid] || c.name}</div>
                    <div className="project-conv-meta">
                      {formatDateShort(c.updated_at)} · {c.messages.length} 条
                    </div>
                  </div>
                  <ChevronRight size={14} className="project-conv-chev" />
                </button>
              ))}
            </div>
          </section>
        )}

        {project.docs.length > 0 && (
          <section className="project-section">
            <h2 className="project-h2">文档 ({project.docs.length})</h2>
            <div className="project-doc-list">
              {project.docs.map(d => (
                <button
                  key={d.uuid}
                  className="project-conv-item"
                  onClick={() => navigate({ kind: 'doc', projectId: project.uuid, docId: d.uuid })}
                >
                  <FileText size={14} strokeWidth={1.8} />
                  <div className="project-conv-info">
                    <div className="project-conv-title">{d.filename || '(无标题)'}</div>
                    <div className="project-conv-meta">
                      {formatDateShort(d.createdAt)} · {d.content.length} 字
                    </div>
                  </div>
                  <ChevronRight size={14} className="project-conv-chev" />
                </button>
              ))}
            </div>
          </section>
        )}

        {conversations.length === 0 && project.docs.length === 0 && !memory && !project.promptTemplate && (
          <div className="project-empty-state">
            <Folder size={32} strokeWidth={1.2} />
            <div>这是一个空项目</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 文档视图
// ============================================================

function DocView({ doc, project, navigate }) {
  return (
    <div className="conv-view">
      <header className="conv-header">
        <button
          className="back-link"
          onClick={() => navigate({ kind: 'project', id: project.uuid })}
        >
          <ArrowLeft size={14} />
          <span>{project.name}</span>
        </button>
        <h1 className="conv-h1">{doc.filename || '(无标题)'}</h1>
        <div className="conv-header-meta">
          <span>{formatDate(doc.createdAt)} · {doc.content.length} 字</span>
        </div>
      </header>
      <div className="doc-body">
        {doc.content ? (
          <div className="doc-content"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(doc.content) }} />
        ) : (
          <div className="doc-empty">空文档</div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 项目列表视图(导航入口 Projects 进入)
// ============================================================

function ProjectsListView({ projects, navigate }) {
  if (!projects || projects.length === 0) {
    return (
      <div className="main-empty">
        <Folder size={28} strokeWidth={1.2} />
        <div>还没有项目</div>
      </div>
    );
  }
  return (
    <div className="conv-view">
      <header className="conv-header">
        <h1 className="conv-h1">项目</h1>
        <p className="conv-summary-text">{projects.length} 个项目,按最近更新排列</p>
      </header>
      <div className="projects-list-body">
        {projects.map(p => {
          const itemCount = p.docs.length;
          return (
            <button
              key={p.uuid}
              className="projects-list-item"
              onClick={() => navigate({ kind: 'project', id: p.uuid })}
            >
              <div className="projects-list-info">
                <div className="projects-list-name">{p.name || '未命名项目'}</div>
                <div className="projects-list-meta">
                  {itemCount > 0 && <span>{itemCount} 篇文档</span>}
                  {itemCount > 0 && p.updatedAt && <span className="dot">·</span>}
                  {p.updatedAt && <span>{formatDateShort(p.updatedAt)}</span>}
                  {!itemCount && !p.updatedAt && <span className="projects-list-faint">空项目</span>}
                </div>
              </div>
              <ChevronRight size={16} className="projects-list-chev" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// 对话视图(同前)
// ============================================================

// ============================================================
// 侧栏对话项 (支持长按)
// ============================================================

function ConvItem({ conv, displayName, starred, active, onClick, onLongPress }) {
  const itemRef = useRef(null);
  const onLongPressInternal = useCallback((pos) => {
    // 优先用对话项 DOM 的位置(更稳定),没有就用按下的坐标
    if (itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      onLongPress({ x: rect.right + 4, y: rect.top + 4 });
    } else {
      onLongPress(pos);
    }
  }, [onLongPress]);
  const { triggeredRef, handlers } = useLongPress(onLongPressInternal);

  const handleClick = (e) => {
    if (triggeredRef.current) {
      e.preventDefault();
      e.stopPropagation();
      triggeredRef.current = false;
      return;
    }
    onClick();
  };

  return (
    <div
      ref={itemRef}
      className={`conv-item ${active ? 'active' : ''}`}
      onClick={handleClick}
      {...handlers}
      role="button"
      tabIndex={0}
    >
      <div className="conv-title-row">
        {starred && <span className="conv-star-dot" />}
        <div className="conv-title">{displayName || conv.name}</div>
      </div>
      <div className="conv-meta">
        <span>{formatDateShort(conv.updated_at)}</span>
        <span className="dot">·</span>
        <span>{conv.messages.length} 条</span>
      </div>
    </div>
  );
}

// ============================================================
// 对话操作菜单 (漂浮卡片,长按触发,贴对话项弹出)
// ============================================================

function ConvContextMenu({ anchor, isStarred, isInProject, onClose, onChangeProject, onToggleStar, onRename, onDelete }) {
  const menuRef = useRef(null);
  const [pos, setPos] = useState({ x: anchor.x, y: anchor.y, ready: false });

  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const pad = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let x = anchor.x;
    let y = anchor.y;
    // 右侧溢出 → 往左挪
    if (x + rect.width > vw - pad) x = vw - rect.width - pad;
    // 底部溢出 → 往上挪
    if (y + rect.height > vh - pad) y = vh - rect.height - pad;
    x = Math.max(pad, x);
    y = Math.max(pad, y);
    setPos({ x, y, ready: true });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="ctx-backdrop" onClick={onClose}>
      <div
        ref={menuRef}
        className="ctx-menu"
        style={{
          left: pos.x,
          top: pos.y,
          opacity: pos.ready ? 1 : 0,
        }}
        onClick={e => e.stopPropagation()}
      >
        <button className="ctx-row" onClick={onChangeProject}>
          <Folder size={15} strokeWidth={1.8} />
          <span>{isInProject ? '更改项目' : '归到项目'}</span>
        </button>
        <button className="ctx-row" onClick={onToggleStar}>
          <Star size={15} strokeWidth={1.8} fill={isStarred ? 'currentColor' : 'none'} />
          <span>{isStarred ? '取消置顶' : '置顶'}</span>
        </button>
        <button className="ctx-row" onClick={onRename}>
          <Pencil size={15} strokeWidth={1.8} />
          <span>重命名</span>
        </button>
        <div className="ctx-sep" />
        <button className="ctx-row ctx-danger" onClick={onDelete}>
          <Trash2 size={15} strokeWidth={1.8} />
          <span>删除</span>
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 重命名 Sheet
// ============================================================

function RenameSheet({ initialValue, onClose, onConfirm }) {
  const [value, setValue] = useState(initialValue || '');
  const inputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 80);
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <Sheet title="重命名" onClose={onClose} closeIcon="x">
      <div className="prompt-body">
        <input
          ref={inputRef}
          className="prompt-input"
          type="text"
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
        <div className="prompt-hint">原始文件不会被修改,只是阅览室里显示这个名字。</div>
        <div className="prompt-actions">
          <button className="prompt-btn" onClick={onClose}>取消</button>
          <button
            className="prompt-btn prompt-btn-primary"
            onClick={submit}
            disabled={!value.trim()}
          >
            保存
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ============================================================
// 删除确认 Sheet
// ============================================================

function DeleteConfirmSheet({ convName, onClose, onConfirm }) {
  return (
    <Sheet title="从阅览室移除" onClose={onClose} closeIcon="x">
      <div className="confirm-body">
        <p className="confirm-text">
          确定不再在阅览室里显示「{convName}」吗?
        </p>
        <p className="confirm-hint">
          原始对话文件不会被修改,只是这里不再显示。如果以后想看,清空重新上传即可。
        </p>
        <div className="prompt-actions">
          <button className="prompt-btn" onClick={onClose}>取消</button>
          <button
            className="prompt-btn prompt-btn-danger"
            onClick={onConfirm}
          >
            从阅览室移除
          </button>
        </div>
      </div>
    </Sheet>
  );
}

// ============================================================
// 对话视图
// ============================================================

function ConversationView({ conv, displayName }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [conv.uuid]);

  const models = useMemo(() => {
    const s = new Set();
    conv.messages.forEach(m => m.model && s.add(m.model));
    return [...s];
  }, [conv]);

  return (
    <div className="conv-view" ref={scrollRef}>
      <header className="conv-header">
        <h1 className="conv-h1">{displayName || conv.name}</h1>
        {conv.summary && <p className="conv-summary-text">{conv.summary}</p>}
        <div className="conv-header-meta">
          <span>{formatDate(conv.created_at)} · 共 {conv.messages.length} 条</span>
          {models.length > 0 && (
            <div className="model-chips">
              {models.map(m => <span key={m} className="model-chip">{shortModel(m)}</span>)}
            </div>
          )}
        </div>
      </header>
      <div className="messages">
        {conv.messages.map(m => <MessageBubble key={m.uuid} message={m} />)}
      </div>
    </div>
  );
}

function groupBlocks(blocks) {
  const groups = [];
  let timeline = [];
  const flush = () => {
    if (timeline.length) {
      groups.push({ kind: 'timeline', items: timeline });
      timeline = [];
    }
  };
  for (const b of blocks) {
    if (b.type === 'text') {
      if (b.text && b.text.trim()) {
        flush();
        groups.push({ kind: 'text', text: b.text });
      }
    } else if (b.type === 'image') {
      flush();
      groups.push({ kind: 'image' });
    } else {
      timeline.push(b);
    }
  }
  flush();
  return groups;
}

function MessageBubble({ message }) {
  const isHuman = message.role === 'human';
  const [metaOpen, setMetaOpen] = useState(false);
  const groups = useMemo(() => groupBlocks(message.blocks), [message.blocks]);

  if (groups.length === 0) return null;

  if (isHuman) {
    return (
      <div className="msg msg-human">
        <div className="msg-human-col">
          <button
            className="msg-body msg-body-human"
            onClick={() => setMetaOpen(!metaOpen)}
            type="button"
          >
            {groups.map((g, i) => {
              if (g.kind === 'text') {
                return (
                  <div key={i} className="msg-content"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(g.text) }} />
                );
              }
              if (g.kind === 'image') {
                return <div key={i} className="msg-note">[图片]</div>;
              }
              return null;
            })}
          </button>
          {metaOpen && (
            <div className="msg-human-meta">
              <span className="msg-human-date">{formatDate(message.created_at)}</span>
              <span className="msg-action msg-action-sm"><RotateCcw size={15} strokeWidth={2} /></span>
              <span className="msg-action msg-action-sm"><Pencil size={15} strokeWidth={2} /></span>
              <span className="msg-action msg-action-sm"><Copy size={15} strokeWidth={2} /></span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="msg msg-assistant">
      <div className="msg-body">
        {groups.map((g, i) => {
          if (g.kind === 'text') {
            return (
              <div key={i} className="msg-content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(g.text) }} />
            );
          }
          if (g.kind === 'timeline') {
            return <ThinkingBar key={i} items={g.items} />;
          }
          if (g.kind === 'image') {
            return <div key={i} className="msg-note">[图片]</div>;
          }
          return null;
        })}
        <MessageActions />
        {message.model && (
          <div className="msg-model">{shortModel(message.model)}</div>
        )}
      </div>
    </div>
  );
}

function MessageActions() {
  return (
    <div className="msg-actions" aria-hidden="true">
      <span className="msg-action"><Copy size={15.5} strokeWidth={2} /></span>
      <span className="msg-action"><Upload size={15.5} strokeWidth={2} /></span>
      <span className="msg-action"><Play size={15.5} strokeWidth={2} /></span>
      <span className="msg-action"><ThumbsUp size={15.5} strokeWidth={2} /></span>
      <span className="msg-action"><ThumbsDown size={15.5} strokeWidth={2} /></span>
      <span className="msg-action"><RotateCcw size={15.5} strokeWidth={2} /></span>
    </div>
  );
}

function ThinkingBar({ items }) {
  const [view, setView] = useState(null);
  const merged = useMemo(() => mergeToolResults(items), [items]);
  const summary = useMemo(() => getOverallSummary(merged), [merged]);
  const onlyOneThinking = merged.length === 1 && merged[0].type === 'thinking';

  const open = () => {
    if (onlyOneThinking) {
      setView({ kind: 'thought', text: merged[0].text, fromSummary: false });
    } else {
      setView({ kind: 'summary' });
    }
  };
  const closeAll = () => setView(null);
  const back = () => {
    if (view?.kind === 'thought' && view.fromSummary) {
      setView({ kind: 'summary' });
    } else {
      closeAll();
    }
  };

  return (
    <>
      <button className="thinking-bar" onClick={open}>
        <DashedClock size={17} />
        <span className="tb-text">{summary}</span>
        <ChevronRight size={15} className="tb-chev" />
      </button>
      {view?.kind === 'summary' && (
        <SummarySheet items={merged} onClose={closeAll}
          onOpenThought={(text) => setView({ kind: 'thought', text, fromSummary: true })} />
      )}
      {view?.kind === 'thought' && (
        <ThoughtSheet text={view.text} fromSummary={view.fromSummary}
          onClose={view.fromSummary ? back : closeAll} />
      )}
    </>
  );
}

function mergeToolResults(items) {
  const out = [];
  for (const it of items) {
    if (it.type === 'tool_result' &&
        out.length > 0 &&
        out[out.length - 1].type === 'tool_use') {
      out[out.length - 1] = { ...out[out.length - 1], result: it };
    } else {
      out.push(it);
    }
  }
  return out;
}

function SummarySheet({ items, onClose, onOpenThought }) {
  return (
    <Sheet title="Summary" onClose={onClose} closeIcon="x">
      <div className="summary-timeline">
        {items.map((it, i) => <SummaryRow key={i} item={it} onOpenThought={onOpenThought} />)}
      </div>
    </Sheet>
  );
}

function SummaryRow({ item, onOpenThought }) {
  const [toolOpen, setToolOpen] = useState(false);
  if (item.type === 'thinking') {
    const summary = item.summary || summarizeThinking(item.text);
    const expandable = item.text && item.text.trim().length > 0;
    return (
      <button className="sr-row" onClick={() => expandable && onOpenThought(item.text)} disabled={!expandable}>
        <span className="sr-dot" />
        <span className="sr-text">{summary || '思考'}</span>
        {expandable && <ChevronRight size={14} className="sr-chev" />}
      </button>
    );
  }
  if (item.type === 'tool_use') {
    return (
      <div className={`sr-row-wrap ${toolOpen ? 'open' : ''}`}>
        <button className="sr-row sr-tool" onClick={() => setToolOpen(!toolOpen)}>
          <span className="sr-icon-tool"><Wrench size={11} strokeWidth={2} /></span>
          <span className="sr-text sr-text-tool">{item.name}</span>
          <ChevronRight size={14} className="sr-chev" />
        </button>
        {toolOpen && (
          <div className="sr-detail">
            <div className="sr-section">
              <div className="sr-section-label">参数</div>
              <pre className="sr-pre">{safeJson(item.input)}</pre>
            </div>
            {item.result && item.result.text && (
              <div className="sr-section">
                <div className={`sr-section-label ${item.result.is_error ? 'is-error' : ''}`}>
                  {item.result.is_error ? '错误' : '结果'}
                </div>
                <pre className="sr-pre">{item.result.text}</pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }
  if (item.type === 'tool_result') {
    if (!item.text || !item.text.trim()) return null;
    return (
      <div className={`sr-row-wrap ${toolOpen ? 'open' : ''}`}>
        <button className="sr-row" onClick={() => setToolOpen(!toolOpen)}>
          <span className="sr-dot" />
          <span className="sr-text">{item.is_error ? '工具错误' : '工具结果'}</span>
          <ChevronRight size={14} className="sr-chev" />
        </button>
        {toolOpen && <div className="sr-detail"><pre className="sr-pre">{item.text}</pre></div>}
      </div>
    );
  }
  if (item.type === 'unknown') {
    return (
      <div className="sr-row sr-row-static">
        <span className="sr-dot" />
        <span className="sr-text sr-text-faint">[{item.raw}]</span>
      </div>
    );
  }
  return null;
}

function ThoughtSheet({ text, onClose, fromSummary }) {
  return (
    <Sheet title="Thought process" onClose={onClose} closeIcon={fromSummary ? 'back' : 'x'}>
      <div className="thought-body">{text}</div>
    </Sheet>
  );
}

function Sheet({ title, onClose, closeIcon, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-grab" />
        <div className="sheet-head">
          <button className="sheet-close" onClick={onClose}>
            {closeIcon === 'back' ? <ChevronLeft size={18} /> : <X size={18} />}
          </button>
          <div className="sheet-title">{title}</div>
          <div style={{ width: 32 }} />
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

// ============================================================
// 项目选择 Sheet (手动归类用)
// ============================================================

function ProjectPickerSheet({ projects, currentProjectUuid, onClose, onSelect, onClear }) {
  return (
    <Sheet title="归到项目" onClose={onClose} closeIcon="x">
      <div className="picker-body">
        {currentProjectUuid && (
          <button className="picker-row picker-row-clear" onClick={onClear}>
            <X size={14} strokeWidth={1.8} />
            <span>从当前项目移出</span>
          </button>
        )}
        {projects.length === 0 ? (
          <div className="picker-empty">还没有项目可以选</div>
        ) : (
          <div className="picker-list">
            {projects.map(p => {
              const isCurrent = p.uuid === currentProjectUuid;
              return (
                <button
                  key={p.uuid}
                  className={`picker-row ${isCurrent ? 'picker-row-current' : ''}`}
                  onClick={() => !isCurrent && onSelect(p.uuid)}
                  disabled={isCurrent}
                >
                  <Folder size={14} strokeWidth={1.8} />
                  <span className="picker-name">{p.name || '未命名项目'}</span>
                  {isCurrent && <span className="picker-check">已归</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ============================================================
// 样式
// ============================================================

function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=Hanken+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400&display=swap');

      :root {
        --bg: #F8F8F6;
        --bg-sidebar: #F2F2EF;
        --bg-card: #FBFBF9;
        --bg-human: #EEEEEC;
        --border: #E0DCC9;
        --border-soft: #E5E2D4;
        --text: #2C2A24;
        --text-muted: #7E7867;
        --text-faint: #ADA796;
        --accent: #C96442;
        --accent-soft: #E8B89F;
        --serif: 'Source Serif 4', 'Source Serif Pro', Georgia, serif;
        --sans: 'Hanken Grotesk', -apple-system, BlinkMacSystemFont, sans-serif;
        --mono: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace;
      }
      * { box-sizing: border-box; }
      body { margin: 0; }

      .archive-root {
        font-family: var(--sans);
        color: var(--text);
        background: var(--bg);
        height: 100vh;
        display: flex;
        overflow: hidden;
        position: relative;
      }

      /* ===== 空状态 ===== */
      .archive-empty { align-items: center; justify-content: center; padding: 24px; }
      .empty-inner { max-width: 520px; width: 100%; text-align: center; }
      .empty-mark { font-size: 11px; letter-spacing: 0.35em; color: var(--text-muted); margin-bottom: 24px; }
      .empty-title { font-family: var(--serif); font-weight: 500; font-size: 38px; line-height: 1.15; letter-spacing: -0.02em; margin: 0 0 14px 0; }
      .empty-sub { color: var(--text-muted); font-size: 14.5px; line-height: 1.65; margin: 0 0 32px 0; }
      .drop-zone {
        display: flex; flex-direction: column; align-items: center; gap: 12px;
        padding: 44px 24px;
        border: 1.5px dashed var(--border); border-radius: 12px;
        background: var(--bg-card); cursor: pointer;
        transition: all 0.2s ease; color: var(--text-muted);
      }
      .drop-zone:hover { border-color: var(--accent-soft); color: var(--text); background: #FDFCF8; }
      .drop-zone.drag-over { border-color: var(--accent); background: #FDFCF8; color: var(--text); }
      .drop-zone.loading { opacity: 0.6; pointer-events: none; }
      .drop-text { font-family: var(--serif); font-size: 17px; color: var(--text); }
      .drop-hint { font-size: 12px; color: var(--text-faint); }
      .error-box {
        margin-top: 16px; padding: 12px 14px;
        background: #FBEEE8; border: 1px solid #E8C5B5; border-radius: 8px;
        color: #8B3A1F; font-size: 13px; text-align: left; line-height: 1.55;
      }

      /* ===== Sidebar ===== */
      .sidebar {
        width: 300px; flex-shrink: 0;
        background: var(--bg-sidebar);
        border-right: 1px solid var(--border-soft);
        display: flex; flex-direction: column; overflow: hidden;
        z-index: 30;
      }
      .sidebar-head { padding: 14px 18px 8px; display: flex; align-items: center; justify-content: space-between; }
      .sidebar-head-actions { display: flex; gap: 2px; align-items: center; }
      .brand { font-size: 11px; letter-spacing: 0.35em; color: var(--text-muted); font-weight: 500; }

      .status-bar {
        margin: 0 16px 8px;
        padding: 6px 2px 2px;
        font-size: 11px;
        color: var(--text-muted);
        display: flex;
        gap: 6px;
        align-items: center;
        flex-wrap: wrap;
      }
      .status-bar .sb-sep { color: var(--text-faint); opacity: 0.6; }
      .status-bar .sb-faint { color: var(--text-faint); }

      /* 错误条 */
      .error-banner {
        margin: 4px 14px 8px;
        padding: 8px 10px 10px;
        background: #FBEEE8;
        border: 1px solid #E8C5B5;
        border-radius: 7px;
        font-size: 11.5px;
        color: #8B3A1F;
      }
      .error-banner-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-weight: 500;
        margin-bottom: 4px;
      }
      .error-banner-close {
        background: transparent;
        border: none;
        color: #8B3A1F;
        cursor: pointer;
        padding: 2px;
        display: flex;
        align-items: center;
        opacity: 0.7;
      }
      .error-banner-close:hover { opacity: 1; }
      .error-banner ul {
        margin: 0;
        padding-left: 14px;
        font-family: var(--mono);
        font-size: 10.5px;
        line-height: 1.55;
        color: #8B3A1F;
      }
      .error-banner-more {
        font-family: var(--sans);
        font-style: italic;
        opacity: 0.7;
        list-style: none;
        margin-left: -14px;
      }
      .icon-btn {
        background: transparent; border: none; padding: 6px;
        color: var(--text-muted); cursor: pointer; border-radius: 6px;
        display: flex; align-items: center; justify-content: center;
      }
      .icon-btn:hover { background: var(--border-soft); color: var(--text); }

      /* 账号卡 */
      .account-card {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 4px 14px 8px;
        padding: 8px 10px;
        background: var(--bg-card);
        border: 1px solid var(--border-soft);
        border-radius: 9px;
        font-family: inherit;
        cursor: default;
        text-align: left;
        min-width: 0;
      }
      .account-avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: var(--accent);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 13px;
        font-weight: 500;
        flex-shrink: 0;
      }
      .account-info { flex: 1; min-width: 0; }
      .account-name {
        font-size: 13px;
        font-weight: 500;
        color: var(--text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .account-email {
        font-size: 11px;
        color: var(--text-faint);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* 顶层导航组 */
      .nav-group {
        margin: 4px 0 6px;
        display: flex;
        flex-direction: column;
      }
      .nav-row {
        display: flex;
        align-items: center;
        gap: 10px;
        width: calc(100% - 28px);
        margin: 0 14px 2px;
        padding: 9px 10px;
        background: transparent;
        border: none;
        border-radius: 7px;
        cursor: pointer;
        font-family: inherit;
        font-size: 13.5px;
        color: var(--text);
        text-align: left;
        transition: background 0.12s ease;
      }
      .nav-row:hover { background: rgba(0,0,0,0.03); }
      .nav-row.active {
        background: var(--bg-card);
        box-shadow: inset 0 0 0 1px var(--border-soft);
      }
      .nav-row svg { color: var(--text-muted); flex-shrink: 0; }
      .nav-row span { flex: 1; }
      .nav-count {
        flex: 0 0 auto !important;
        font-size: 11px;
        color: var(--text-faint);
      }

      /* 项目列表页 */
      .projects-list-body {
        max-width: 760px;
        margin: 0 auto;
        padding: 18px 56px 80px;
      }
      .projects-list-item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 14px 16px;
        background: transparent;
        border: none;
        border-bottom: 1px solid var(--border-soft);
        cursor: pointer;
        font-family: inherit;
        text-align: left;
        transition: background 0.12s ease;
      }
      .projects-list-item:hover { background: rgba(0,0,0,0.025); }
      .projects-list-info { flex: 1; min-width: 0; }
      .projects-list-name {
        font-size: 16px;
        font-weight: 500;
        color: var(--text);
        margin-bottom: 4px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .projects-list-meta {
        font-size: 12.5px;
        color: var(--text-muted);
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .projects-list-meta .dot { color: var(--text-faint); }
      .projects-list-faint { color: var(--text-faint); font-style: italic; }
      .projects-list-chev { color: var(--text-faint); flex-shrink: 0; }

      .search-row {
        margin: 6px 14px 4px; padding: 7px 10px;
        background: var(--bg-card); border: 1px solid var(--border-soft); border-radius: 7px;
        display: flex; align-items: center; gap: 8px; color: var(--text-muted);
      }
      .search-row input {
        flex: 1; border: none; background: transparent; outline: none;
        font-family: inherit; font-size: 13px; color: var(--text); min-width: 0;
      }
      .search-row input::placeholder { color: var(--text-faint); }

      .sidebar-scroll { flex: 1; overflow-y: auto; padding-bottom: 14px; }

      .sb-section { margin-top: 10px; }
      .sb-section-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 14px 4px 18px;
      }
      .sb-section-title {
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--text-muted);
        font-weight: 500;
      }
      .sb-section-count { font-size: 11px; color: var(--text-faint); }

      /* 项目区 */
      .project-list { padding: 2px 8px; }
      .project-block { margin-bottom: 1px; }
      .project-row {
        display: flex;
        align-items: stretch;
        border-radius: 6px;
        transition: background 0.12s ease;
      }
      .project-toggle {
        flex-shrink: 0;
        background: transparent;
        border: none;
        padding: 0 4px 0 8px;
        cursor: pointer;
        color: var(--text-muted);
        display: flex;
        align-items: center;
      }
      .project-toggle:hover { color: var(--text); }
      .project-chev { transition: transform 0.15s ease; }
      .project-chev.open { transform: rotate(90deg); }
      .project-main {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 10px 8px 4px;
        background: transparent;
        border: none;
        cursor: pointer;
        font-family: inherit;
        color: var(--text);
        text-align: left;
        min-width: 0;
        border-radius: 6px;
      }
      .project-main.no-toggle { padding-left: 12px; }
      .project-main:hover { background: rgba(0,0,0,0.03); }
      .project-main.active { background: var(--bg-card); box-shadow: inset 0 0 0 1px var(--border-soft); }
      .project-icon { color: var(--text-muted); flex-shrink: 0; }
      .project-name {
        flex: 1;
        font-size: 13.5px;
        font-weight: 500;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
      }
      .project-count {
        font-size: 11px;
        color: var(--text-faint);
        flex-shrink: 0;
      }
      .project-children {
        padding-left: 26px;
        padding-right: 2px;
        margin: 2px 0 4px;
      }
      .child-row {
        display: flex;
        align-items: center;
        gap: 7px;
        width: 100%;
        padding: 6px 10px 6px 8px;
        background: transparent;
        border: none;
        cursor: pointer;
        font-family: inherit;
        color: var(--text);
        text-align: left;
        border-radius: 5px;
        min-width: 0;
        transition: background 0.12s ease;
      }
      .child-row:hover { background: rgba(0,0,0,0.03); }
      .child-row.active { background: var(--bg-card); box-shadow: inset 0 0 0 1px var(--border-soft); }
      .child-icon { color: var(--text-faint); flex-shrink: 0; }
      .child-name {
        flex: 1;
        font-size: 12.5px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        color: var(--text);
      }

      /* 对话区 */
      .conv-list { padding: 2px 8px 14px; }
      .conv-item {
        display: block;
        width: 100%;
        text-align: left;
        background: transparent;
        padding: 9px 12px;
        cursor: pointer;
        color: var(--text);
        font-family: inherit;
        border-radius: 7px;
        margin-bottom: 1px;
        transition: background 0.12s ease;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        outline: none;
      }
      .conv-item:hover { background: rgba(0,0,0,0.03); }
      .conv-item:focus-visible { box-shadow: inset 0 0 0 1px var(--accent-soft); }
      .conv-item.active { background: var(--bg-card); box-shadow: inset 0 0 0 1px var(--border-soft); }
      .conv-title-row {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        margin-bottom: 3px;
      }
      .conv-star-dot {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--accent);
        flex-shrink: 0;
        margin-top: 7px;
      }
      .conv-title {
        flex: 1;
        font-size: 13.5px; line-height: 1.35; font-weight: 500;
        overflow: hidden; display: -webkit-box;
        -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      }
      .conv-meta { font-size: 11.5px; color: var(--text-faint); display: flex; gap: 6px; align-items: center; }
      .no-result { padding: 18px 16px; text-align: center; color: var(--text-faint); font-size: 12.5px; }

      /* 对话操作 sheet */
      .action-body { padding: 4px 0; }
      .action-row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 13px 12px;
        background: transparent;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        font-size: 14.5px;
        color: var(--text);
        text-align: left;
        transition: background 0.12s ease;
      }
      .action-row:hover { background: rgba(0,0,0,0.04); }
      .action-row svg { color: var(--text-muted); flex-shrink: 0; }

      /* ===== Main ===== */
      .main { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-width: 0; }
      .main-empty {
        flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 10px; color: var(--text-faint); font-size: 14px;
      }
      .mobile-bar { display: none; }

      .conv-view { flex: 1; overflow-y: auto; }
      .conv-header {
        padding: 36px 56px 18px;
        border-bottom: 1px solid var(--border-soft);
        max-width: 820px; margin: 0 auto; width: 100%;
      }
      .conv-h1 {
        font-family: var(--serif); font-weight: 500;
        font-size: 28px; letter-spacing: -0.015em;
        line-height: 1.25; margin: 0 0 8px 0; word-break: break-word;
      }
      .conv-summary-text {
        font-family: var(--serif); font-size: 15px; line-height: 1.6;
        color: var(--text-muted); font-style: italic; margin: 0 0 14px 0;
      }
      .conv-header-meta {
        display: flex; align-items: center; justify-content: space-between;
        flex-wrap: wrap; gap: 12px;
        font-size: 12.5px; color: var(--text-muted);
      }
      .model-chips { display: flex; gap: 6px; flex-wrap: wrap; }
      .model-chip {
        padding: 2px 8px; background: var(--bg-card);
        border: 1px solid var(--border-soft); border-radius: 999px;
        font-size: 11px; color: var(--text-muted); font-family: var(--mono);
      }

      /* 对话归类标签 */
      .conv-project-row {
        margin-top: 12px;
        display: flex;
      }
      .conv-project-tag {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px 4px 8px;
        background: var(--bg-card);
        border: 1px solid var(--border-soft);
        border-radius: 999px;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        color: var(--text);
        transition: all 0.12s ease;
      }
      .conv-project-tag:hover { background: #FDFCF8; border-color: var(--accent-soft); }
      .conv-project-tag svg { color: var(--text-muted); }
      .conv-project-edit { opacity: 0.5; margin-left: 2px; }
      .conv-project-add {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px 4px 8px;
        background: transparent;
        border: 1px dashed var(--border);
        border-radius: 999px;
        cursor: pointer;
        font-family: inherit;
        font-size: 12px;
        color: var(--text-muted);
        transition: all 0.12s ease;
      }
      .conv-project-add:hover { border-color: var(--accent-soft); color: var(--text); background: var(--bg-card); }

      /* 项目选择 sheet */
      .picker-body { padding: 4px 0 8px; }
      .picker-list { display: flex; flex-direction: column; }
      .picker-empty {
        padding: 28px 12px;
        text-align: center;
        color: var(--text-faint);
        font-size: 13px;
        font-style: italic;
      }
      .picker-row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 12px 12px;
        background: transparent;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-family: inherit;
        font-size: 14.5px;
        color: var(--text);
        text-align: left;
        transition: background 0.12s ease;
      }
      .picker-row:hover:not(:disabled) { background: rgba(0,0,0,0.04); }
      .picker-row:disabled { cursor: default; }
      .picker-row svg { color: var(--text-muted); flex-shrink: 0; }
      .picker-name {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .picker-check {
        font-size: 11.5px;
        color: var(--accent);
        flex-shrink: 0;
      }
      .picker-row-current .picker-name { color: var(--text-muted); }
      .picker-row-clear {
        margin-bottom: 6px;
        border-bottom: 1px solid var(--border-soft);
        border-radius: 0;
        color: var(--text-muted);
      }
      .picker-row-clear svg { color: var(--text-muted); }

      /* 漂浮卡片菜单(长按弹出) */
      .ctx-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100;
        background: transparent;
      }
      .ctx-menu {
        position: fixed;
        background: rgba(248, 248, 246, 0.97);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border: 1px solid rgba(0,0,0,0.06);
        border-radius: 12px;
        padding: 6px;
        min-width: 220px;
        box-shadow: 0 10px 36px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.06);
        transition: opacity 0.12s ease;
      }
      .ctx-row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 10px 12px;
        background: transparent;
        border: none;
        border-radius: 8px;
        font-family: inherit;
        font-size: 14.5px;
        color: var(--text);
        cursor: pointer;
        text-align: left;
        transition: background 0.1s ease;
      }
      .ctx-row:hover { background: rgba(0,0,0,0.05); }
      .ctx-row:active { background: rgba(0,0,0,0.08); }
      .ctx-row svg { color: var(--text-muted); flex-shrink: 0; }
      .ctx-sep {
        height: 1px;
        background: rgba(0,0,0,0.08);
        margin: 4px 6px;
      }
      .ctx-row.ctx-danger { color: #DC2626; }
      .ctx-row.ctx-danger svg { color: #DC2626; }

      /* 重命名 prompt sheet */
      .prompt-body {
        padding: 10px 4px 24px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .prompt-input {
        width: 100%;
        padding: 13px 14px;
        background: var(--bg-card);
        border: 1px solid var(--border-soft);
        border-radius: 10px;
        font-family: inherit;
        font-size: 15px;
        color: var(--text);
        outline: none;
        transition: border-color 0.12s, background 0.12s;
      }
      .prompt-input:focus {
        border-color: var(--accent-soft);
        background: #FDFCF8;
      }
      .prompt-hint {
        font-size: 12px;
        color: var(--text-muted);
        line-height: 1.5;
        margin: -4px 2px 4px;
      }
      .prompt-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 4px;
      }
      .prompt-btn {
        padding: 10px 18px;
        background: transparent;
        border: 1px solid var(--border-soft);
        border-radius: 8px;
        font-family: inherit;
        font-size: 14px;
        color: var(--text);
        cursor: pointer;
        transition: all 0.12s ease;
      }
      .prompt-btn:hover { background: rgba(0,0,0,0.03); }
      .prompt-btn-primary {
        background: var(--text);
        color: var(--bg);
        border-color: var(--text);
      }
      .prompt-btn-primary:hover { background: #1f1d18; }
      .prompt-btn-primary:disabled {
        background: var(--text-faint);
        border-color: var(--text-faint);
        cursor: default;
      }
      .prompt-btn-danger {
        background: #DC2626;
        color: white;
        border-color: #DC2626;
      }
      .prompt-btn-danger:hover { background: #B91C1C; border-color: #B91C1C; }

      /* 删除确认 */
      .confirm-body {
        padding: 8px 4px 24px;
      }
      .confirm-text {
        font-size: 15px;
        line-height: 1.55;
        color: var(--text);
        margin: 0 0 10px 0;
      }
      .confirm-hint {
        font-size: 12.5px;
        line-height: 1.6;
        color: var(--text-muted);
        margin: 0 0 16px 0;
      }

      .back-link {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        background: transparent;
        border: none;
        padding: 0;
        margin-bottom: 12px;
        cursor: pointer;
        color: var(--text-muted);
        font-family: inherit;
        font-size: 13px;
      }
      .back-link:hover { color: var(--text); }

      .messages { padding: 24px 56px 80px; max-width: 820px; margin: 0 auto; width: 100%; }

      /* ===== 记忆视图 ===== */
      .memory-body {
        max-width: 760px;
        margin: 0 auto;
        padding: 28px 56px 80px;
      }
      .memory-section { margin-bottom: 36px; }
      .memory-section:last-child { margin-bottom: 0; }
      .memory-h2 {
        font-family: var(--serif);
        font-weight: 500;
        font-size: 22px;
        letter-spacing: -0.01em;
        margin: 0 0 16px 0;
        color: var(--text);
      }
      .memory-content {
        font-family: var(--serif);
        font-size: 17px;
        line-height: 1.85;
        color: var(--text);
      }
      .memory-content-sm {
        font-family: var(--sans);
        font-size: 14.5px;
        line-height: 1.75;
      }
      .memory-content > *:first-child { margin-top: 0; }
      .memory-content > *:last-child { margin-bottom: 0; }
      .memory-content p { margin: 0 0 18px 0; }
      .memory-content strong {
        font-weight: 600;
        color: var(--text);
        font-family: var(--sans);
        font-size: 0.9em;
        letter-spacing: 0.02em;
        text-transform: uppercase;
        display: block;
        margin-top: 4px;
        margin-bottom: -4px;
        color: var(--text-muted);
      }
      .memory-content em { font-style: italic; color: var(--text-muted); }
      .memory-content-sm strong {
        display: inline;
        text-transform: none;
        font-size: 1em;
        font-weight: 600;
        color: var(--text);
        margin: 0;
        letter-spacing: 0;
      }

      .memory-project-block {
        margin-bottom: 24px;
        padding: 18px 20px;
        background: var(--bg-card);
        border: 1px solid var(--border-soft);
        border-radius: 10px;
      }
      .memory-project-name {
        display: flex;
        align-items: center;
        gap: 8px;
        background: transparent;
        border: none;
        padding: 0;
        margin: 0 0 14px 0;
        cursor: pointer;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        color: var(--text);
      }
      .memory-project-name:hover { color: var(--accent); }
      .memory-project-name svg:first-child { color: var(--text-muted); }
      .memory-project-name svg:last-child { color: var(--text-faint); margin-left: auto; }

      .memory-meta-section { margin-top: 48px; }
      .memory-meta {
        display: flex;
        align-items: center;
        gap: 12px;
        font-size: 11.5px;
        color: var(--text-faint);
      }
      .memory-meta-label {
        font-family: var(--mono);
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      .memory-meta-value {
        font-family: var(--mono);
        font-size: 11px;
        color: var(--text-muted);
        background: var(--bg-card);
        padding: 3px 8px;
        border-radius: 4px;
        border: 1px solid var(--border-soft);
      }

      /* ===== 项目视图 ===== */
      .project-body {
        max-width: 760px;
        margin: 0 auto;
        padding: 24px 56px 80px;
      }
      .project-section { margin-bottom: 32px; }
      .project-h2 {
        font-family: var(--serif);
        font-weight: 500;
        font-size: 18px;
        margin: 0 0 14px 0;
        color: var(--text);
      }
      .prompt-template {
        font-family: var(--sans);
        font-size: 14.5px;
        line-height: 1.7;
        color: var(--text);
        padding: 16px 18px;
        background: var(--bg-card);
        border: 1px solid var(--border-soft);
        border-radius: 8px;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .prompt-template > *:first-child { margin-top: 0; }
      .prompt-template > *:last-child { margin-bottom: 0; }

      .project-conv-list, .project-doc-list {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .project-conv-item {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 12px 14px;
        background: var(--bg-card);
        border: 1px solid var(--border-soft);
        border-radius: 9px;
        cursor: pointer;
        font-family: inherit;
        text-align: left;
        transition: background 0.12s ease;
        margin-bottom: 6px;
      }
      .project-conv-item:hover { background: #FDFCF8; border-color: var(--accent-soft); }
      .project-conv-item > svg:first-child { color: var(--text-muted); flex-shrink: 0; }
      .project-conv-info { flex: 1; min-width: 0; }
      .project-conv-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--text);
        margin-bottom: 3px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .project-conv-meta {
        font-size: 11.5px;
        color: var(--text-faint);
      }
      .project-conv-chev { color: var(--text-faint); flex-shrink: 0; }

      .project-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 60px 20px;
        gap: 12px;
        color: var(--text-faint);
        font-size: 13.5px;
        font-style: italic;
      }

      /* ===== 文档视图 ===== */
      .doc-body {
        max-width: 760px;
        margin: 0 auto;
        padding: 24px 56px 80px;
      }
      .doc-content {
        font-family: var(--serif);
        font-size: 16.5px;
        line-height: 1.85;
        color: var(--text);
        white-space: pre-wrap;
        word-break: break-word;
      }
      .doc-content > *:first-child { margin-top: 0; }
      .doc-content p { margin: 0 0 16px 0; }
      .doc-empty {
        padding: 60px 20px;
        text-align: center;
        color: var(--text-faint);
        font-style: italic;
      }

      /* ===== 对话消息(同前) ===== */
      .msg { display: flex; margin-bottom: 28px; }
      .msg-assistant { justify-content: flex-start; }
      .msg-human { justify-content: flex-end; }
      .msg-assistant .msg-body { width: 100%; max-width: 100%; }
      .msg-human-col {
        display: flex; flex-direction: column; align-items: flex-end;
        max-width: 78%;
      }
      .msg-body-human {
        background: var(--bg-human);
        padding: 12px 17px;
        border-radius: 22px;
        border: none;
        font-family: inherit;
        color: var(--text);
        text-align: left;
        cursor: pointer;
        transition: filter 0.12s ease;
      }
      .msg-body-human:hover { filter: brightness(0.97); }
      .msg-body-human:active { filter: brightness(0.94); }
      .msg-human-meta {
        margin-top: 8px;
        display: flex; align-items: center; gap: 12px;
        color: var(--text-muted);
        animation: fadeInUp 0.18s ease;
      }
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(-3px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .msg-human-date { font-size: 13px; color: var(--text-muted); margin-right: 2px; }

      .msg-content { font-size: 16px; line-height: 1.72; color: var(--text); }
      .msg-content > *:first-child { margin-top: 0; }
      .msg-content > *:last-child { margin-bottom: 0; }
      .msg-content p { margin: 0 0 16px 0; }
      .msg-content h1, .msg-content h2, .msg-content h3,
      .msg-content h4, .msg-content h5, .msg-content h6 {
        font-family: var(--serif); font-weight: 500;
        letter-spacing: -0.01em; margin: 22px 0 10px; line-height: 1.3;
      }
      .msg-content h1 { font-size: 23px; }
      .msg-content h2 { font-size: 20px; }
      .msg-content h3 { font-size: 17.5px; }
      .msg-content ul, .msg-content ol { margin: 0 0 16px 0; padding-left: 24px; }
      .msg-content li { margin-bottom: 4px; }
      .msg-content strong { font-weight: 600; }
      .msg-content em { font-style: italic; }
      .msg-content a {
        color: var(--accent); text-decoration: underline;
        text-decoration-color: var(--accent-soft); text-underline-offset: 2px;
        word-break: break-all;
      }
      .msg-content blockquote {
        margin: 0 0 16px 0; padding: 4px 14px;
        border-left: 3px solid var(--border);
        color: var(--text-muted); font-style: italic;
      }
      .msg-content .inline-code {
        font-family: var(--mono); font-size: 0.88em;
        background: var(--bg-human); padding: 1.5px 6px; border-radius: 4px;
      }
      .msg-body-human .msg-content .inline-code { background: rgba(255,255,255,0.5); }
      .msg-content .code-block {
        background: #2A2722; color: #E8E2CF;
        padding: 14px 16px; border-radius: 8px;
        overflow-x: auto; margin: 0 0 16px 0;
        font-size: 13.5px; line-height: 1.55;
      }
      .msg-content .code-block code { font-family: var(--mono); background: none; color: inherit; padding: 0; }
      .msg-model { margin-top: 6px; font-family: var(--mono); font-size: 10.5px; color: var(--text-faint); }
      .msg-note { font-size: 12px; color: var(--text-faint); font-style: italic; margin: 6px 0; }

      .msg-actions {
        display: flex; gap: 14px; margin-top: 12px;
        color: var(--text-muted); align-items: center;
      }
      .msg-action {
        display: inline-flex; align-items: center; justify-content: center;
        cursor: default; color: var(--text-muted);
      }

      .thinking-bar {
        display: flex; align-items: center; gap: 8px;
        width: 100%; padding: 11px 6px; margin: 4px 0 14px;
        background: transparent; border: none; border-radius: 6px;
        cursor: pointer; font-family: inherit; text-align: left;
        color: var(--text-muted); transition: background 0.12s ease;
      }
      .thinking-bar:hover { background: rgba(0,0,0,0.025); }
      .tb-text {
        flex: 1; font-size: 14.5px; color: var(--text-muted); line-height: 1.45;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
      }
      .tb-chev { flex-shrink: 0; color: var(--text-faint); }

      /* ===== Sheet ===== */
      .sheet-backdrop {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.4);
        z-index: 100;
        display: flex; align-items: flex-end; justify-content: center;
        animation: fadeIn 0.18s ease;
      }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
      .sheet {
        width: 100%; max-width: 640px; height: 65vh;
        background: var(--bg);
        border-radius: 16px 16px 0 0;
        display: flex; flex-direction: column; overflow: hidden;
        animation: slideUp 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
        box-shadow: 0 -8px 32px rgba(0,0,0,0.15);
      }
      @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
      .sheet-grab { width: 36px; height: 4px; border-radius: 2px; background: var(--border); margin: 8px auto 0; flex-shrink: 0; }
      .sheet-head {
        padding: 10px 14px 14px;
        display: flex; align-items: center; justify-content: space-between;
        gap: 10px; flex-shrink: 0;
      }
      .sheet-close {
        width: 32px; height: 32px; border-radius: 50%;
        background: rgba(0,0,0,0.05); border: none;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; color: var(--text);
      }
      .sheet-close:hover { background: rgba(0,0,0,0.08); }
      .sheet-title {
        flex: 1; text-align: center;
        font-size: 15px; font-weight: 600; color: var(--text);
      }
      .sheet-body { flex: 1; overflow-y: auto; padding: 4px 18px 24px; }

      .summary-timeline { position: relative; padding-left: 14px; margin-top: 8px; }
      .summary-timeline::before {
        content: ''; position: absolute;
        left: 4px; top: 14px; bottom: 14px;
        width: 1.5px; background: var(--border-soft);
      }
      .sr-row-wrap { position: relative; margin: 1px 0; }
      .sr-row {
        position: relative; display: flex; align-items: center;
        gap: 10px; width: 100%; padding: 9px 8px 9px 4px;
        background: transparent; border: none; border-radius: 5px;
        cursor: pointer; font-family: inherit; text-align: left;
        color: inherit; min-height: 30px;
      }
      .sr-row:disabled { cursor: default; }
      .sr-row:hover:not(:disabled) { background: rgba(0,0,0,0.025); }
      .sr-row-static { cursor: default; }
      .sr-dot {
        position: absolute; left: -14px; top: 50%;
        width: 7px; height: 7px; border-radius: 50%;
        background: var(--text-faint);
        border: 2px solid var(--bg); box-sizing: content-box;
        transform: translateY(-50%);
      }
      .sr-icon-tool {
        position: absolute; left: -17px; top: 50%;
        transform: translateY(-50%);
        background: var(--bg); color: var(--text-muted);
        padding: 2px; border-radius: 3px; display: flex;
      }
      .sr-text {
        flex: 1; font-size: 14.5px; color: var(--text); line-height: 1.5;
        overflow: hidden; text-overflow: ellipsis; min-width: 0;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
      }
      .sr-text-tool { font-family: var(--mono); font-size: 13px; color: var(--text); -webkit-line-clamp: 1; }
      .sr-text-faint { color: var(--text-faint); }
      .sr-chev { flex-shrink: 0; color: var(--text-faint); transition: transform 0.15s ease; }
      .sr-row-wrap.open .sr-chev { transform: rotate(90deg); }
      .sr-detail {
        margin: 4px 0 10px 0; padding: 10px 12px;
        background: rgba(255,255,255,0.5);
        border: 1px solid var(--border-soft); border-radius: 6px;
      }
      .sr-section + .sr-section { margin-top: 10px; }
      .sr-section-label {
        font-family: var(--mono); font-size: 10.5px;
        letter-spacing: 0.04em; text-transform: uppercase;
        color: var(--text-faint); margin-bottom: 4px;
      }
      .sr-section-label.is-error { color: #8B3A1F; }
      .sr-pre {
        margin: 0; font-family: var(--mono);
        font-size: 11.5px; line-height: 1.55; color: var(--text);
        white-space: pre-wrap; word-break: break-word;
        max-height: 320px; overflow-y: auto;
      }

      .thought-body {
        font-family: var(--sans);
        font-size: 16px; line-height: 1.8; color: var(--text);
        white-space: pre-wrap; word-break: break-word;
        padding: 8px 0 24px;
      }

      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.12); border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.2); }

      .sidebar-mask {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.35);
        z-index: 25; animation: fadeIn 0.18s ease;
      }

      @media (max-width: 768px) {
        .sidebar {
          position: fixed; top: 0; left: 0;
          height: 100vh; width: 84%; max-width: 320px;
          transform: translateX(-100%);
          transition: transform 0.22s ease;
          box-shadow: 4px 0 24px rgba(0,0,0,0.08);
        }
        .sidebar.open { transform: translateX(0); }

        .mobile-bar {
          display: flex; align-items: center; justify-content: space-between;
          padding: 10px 12px;
          border-bottom: 1px solid var(--border-soft);
          background: var(--bg);
          flex-shrink: 0; z-index: 10;
        }
        .mobile-title {
          flex: 1; text-align: center;
          font-size: 13.5px; color: var(--text); font-weight: 500;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          padding: 0 8px;
        }

        .conv-header { padding: 22px 20px 14px; }
        .conv-h1 { font-size: 22px; }
        .conv-summary-text { font-size: 13.5px; }
        .messages, .memory-body, .project-body, .doc-body, .projects-list-body { padding: 18px 18px 60px; }
        .projects-list-item { padding: 14px 4px; }
        .memory-content { font-size: 16px; }
        .doc-content { font-size: 15.5px; }
        .memory-h2 { font-size: 20px; }
        .msg { margin-bottom: 24px; }
        .msg-human-col { max-width: 82%; }
        .msg-body-human { border-radius: 20px; }

        .sheet { border-radius: 14px 14px 0 0; height: 70vh; }
        .sheet-body { padding: 4px 14px 24px; }
        .thought-body { font-size: 15.5px; }
      }
    `}</style>
  );
}