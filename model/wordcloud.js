import crypto from 'node:crypto'

// 停用词库：涵盖中文高频虚词、代词、介词、助词、水群口癖、时间/数量词、机器人指令残留以及常用英文无意义词
const STOP_WORDS = new Set([
  // 代词与指代
  '我', '你', '他', '她', '它', '我们', '你们', '他们', '她们', '它们', '自己', '大家', '各位', '人家', '谁谁', '某人', '有人', '本人', '彼此', '咱', '咱们', '诸位',
  '这个', '那个', '这些', '那些', '这种', '那种', '这里', '那里', '这儿', '那儿', '这边', '那边', '这般', '那般', '这么', '那么', '多么', '这样', '那样', '怎样', '怎么', '什么', '哪个', '哪些', '某某', '任何', '所有', '一切', '每个', '每当', '各个',

  // 语气助词、叹词与网络口头禅
  '的', '地', '得', '了', '着', '过', '呢', '吧', '啊', '呀', '哇', '啦', '嘛', '么', '捏', '呐', '呗', '哩', '哉', '矣', '乎', '者', '也', '兮',
  '哈哈', '哈哈哈', '哈哈哈哈', '呵呵', '呵呵呵', '嘿嘿', '嘻嘻', '嘻嘻嘻', '嗷嗷', '嘤嘤', '嘤嘤嘤', '呜呜', '呜呜呜', '哎呀', '哎哟', '卧槽', '我靠', '我擦', '卧槽槽', '我去', '好家伙', '笑死', '笑死我了', '蚌埠', '蚌埠住了', '绷不住', '难绷', '乐了', '绝了', '无语', '离谱', '急了', '赢了', '输了', '寄了', '救命', '破防', '牛逼', '牛批', '牛波一', '真的假', '真的假的', '好家伙', '真假',

  // 介词、连词、逻辑词
  '因为', '所以', '如果', '要是', '假如', '倘若', '即使', '就算', '哪怕', '虽然', '尽管', '固然', '但是', '可是', '然而', '不过', '只是', '而且', '并且', '况且', '何况', '甚至', '或者', '还是', '要么', '与其', '不如', '宁可', '宁愿', '既然', '因而', '从而', '进而', '以致', '以至于', '由此可见', '总而言之', '换句话说', '也就是说',
  '在', '从', '向', '往', '朝', '沿着', '随', '按', '照', '依据', '根据', '通过', '经由', '由于', '因', '对于', '关于', '至于', '替', '给', '被', '把', '叫', '让', '由',

  // 副词（程度、时间、范围、情态）
  '感觉', '觉得', '认为', '以为', '好像', '似乎', '仿佛', '应该', '可能', '大概', '也许', '或许', '反正', '总之', '话说', '讲真', '老实说', '说实话', '讲道理', '有一说一', '确实', '确实是', '差不多', '基本上', '总体上', '实际上', '事实上', '原则上', '理论上', '话说回来', '看起来', '听起来', '说起来', '想起来', '算起来',
  '特别', '非常', '十分', '极其', '格外', '分外', '相当', '稍微', '略微', '有点', '有些', '太', '真', '挺', '很', '蛮', '更', '越', '越发', '更加', '越加', '比较', '几乎', '简直', '大致', '大体', '大抵', '约莫', '顶多', '至多', '起码', '至少',
  '正好', '恰好', '刚好', '偏偏', '反倒', '反而', '幸亏', '多亏', '好在', '索性', '干脆', '不妨', '难免', '未免', '不免', '何必', '何苦', '何妨', '难道', '莫非', '岂非', '究竟', '到底',
  '从来', '向来', '历来', '一直', '始终', '经常', '常常', '往往', '平时', '平常', '时常', '有时', '偶尔', '随时', '立刻', '马上', '赶紧', '连忙', '顿时', '刚刚', '刚才', '方才', '正在', '已经', '曾经', '快要', '将要', '早就', '未曾', '不曾', '何曾',
  '不仅', '不光', '单单', '光是', '仅仅', '只', '只有', '除非', '只得', '只好', '只能', '不可', '不得不', '莫非', '未尝',

  // 水群常见泛动词与交互词
  '知道', '看看', '看下', '看到', '看见', '去看', '来着', '出来', '进去', '起来', '过去', '过来', '回去', '回来', '说话', '发言', '聊天', '发消息', '水群', '进群', '退群', '冒泡', '潜水', '艾特', '回复', '引用', '转发', '复制', '粘贴', '截图', '撤回', '拍一拍',
  '是不是', '能不能', '行不行', '可不可以', '对不对', '好不好', '有没有', '算了吧', '算了', '不行', '可以', '不会', '不能', '不要', '别这样', '怎么会', '怎么能', '怎么搞', '怎么弄', '怎么做', '怎么看', '怎么办', '怎么回事', '为什么', '什么鬼', '什么东西', '搞毛', '搞啥', '干嘛', '干啥',
  '好的', '好吧', '行吧', '行啊', '好啊', '对啊', '是啊', '没错', '对对对', '是的是的', '恩恩', '嗯嗯', '欧克', '收到', '了解', '明白', '清楚', '希望', '打算', '准备', '想要', '需要', '变成', '继续', '开始', '结束', '进行', '完成', '出现', '存在', '包含', '产生', '导致', '造成', '包括', '属于',

  // 时间、量词、方向
  '今天', '明天', '后天', '昨天', '前天', '现在', '以前', '过去', '后来', '将来', '未来', '刚才', '刚刚', '这几天', '前几天', '后几天', '每天', '天天', '当时', '那时', '此时', '那会儿', '这会儿', '什么时候', '几点',
  '早上', '中午', '下午', '晚上', '半夜', '凌晨', '周末', '星期', '礼拜', '这周', '上周', '下周', '去年', '今年', '明年',
  '一个', '两个', '三个', '四个', '五个', '六个', '七个', '八个', '九个', '十个', '几个', '很多', '许多', '不少', '一些', '一点', '一点点', '一样', '一堆', '一群', '一波', '一下', '一下子', '一趟', '一遍', '一回', '一次', '多次', '一种', '几十', '几百', '几千', '几万',
  '里面', '外面', '上面', '下面', '前面', '后面', '中间', '旁边', '周围',

  // 协议残留、机器人指令与技术通用词
  '图片', '表情', '动画表情', '语音', '视频', '文件', '消息', '文本', '内容', '名字', '昵称', '群名', '群聊', '群友', '机器人', '插件', '指令', '搜索', '查询', '记录', '数据', '历史', '今日', '词云', '画像', '学舌', '图谱', '溯源', 'tag',
  'http', 'https', 'www', 'com', 'cn', 'net', 'org', 'html', 'url', 'json', 'xml', 'null', 'undefined', 'true', 'false', 'nan',
  'div', 'span', 'img', 'src', 'href', 'class', 'style', 'color', 'width', 'height', 'type', 'id', 'key', 'value', 'code', 'data', 'token', 'request', 'response', 'error', 'status', 'import', 'export', 'const', 'let', 'var', 'function', 'return', 'async', 'await',

  // 英文无意义停用词
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'can\'t', 'cannot', 'could', 'couldn\'t',
  'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during',
  'each', 'few', 'for', 'from', 'further',
  'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s',
  'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'just',
  'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my', 'myself',
  'no', 'nor', 'not', 'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some', 'such',
  'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very',
  'was', 'wasn\'t', 'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t',
  'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves'
])

// Jieba 词性标注过滤：排除虚词、代词、介词、助词、标点、量词、数词等
const REJECT_POS_PREFIX = ['r', 'p', 'c', 'u', 'y', 'e', 'o', 'w', 'm', 'q', 'd', 'f', 's', 't']

let tokenizerPromise = null

/**
 * 统计并生成词频数据
 * @param {string[]} texts 待分词文本列表
 * @returns {Promise<Array<{ text: string, count: number }>>}
 */
export async function buildWordCloudWords (texts) {
  const tokenizer = await getTokenizer()
  const counter = new Map()

  for (const text of texts) {
    for (const word of tokenize(text, tokenizer)) {
      counter.set(word, (counter.get(word) || 0) + 1)
    }
  }

  return [...counter.entries()]
    .filter(([, count]) => count >= 2)
    .map(([text, count]) => ({ text, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * 获取分词器实例（优先使用高性能 @node-rs/jieba 或 nodejieba，未安装则自动回退至 Intl.Segmenter）
 */
export async function getTokenizer () {
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
      // 1. 尝试使用 Rust 编写的高性能 @node-rs/jieba
      try {
        const mod = await import('@node-rs/jieba')
        const tagFn = mod.tag || mod.default?.tag
        if (tagFn) {
          const tokenizer = {
            type: '@node-rs/jieba',
            segment: text => {
              const tagged = tagFn(text)
              return tagged
                .map(parseTaggedToken)
                .filter(item => {
                  const tag = item.tag || ''
                  return !REJECT_POS_PREFIX.some(prefix => tag.startsWith(prefix))
                })
                .map(item => item.word)
            }
          }
          if (isTokenizerUsable(tokenizer)) return tokenizer
        }

        const cutFn = mod.cut || mod.default?.cut
        if (cutFn) {
          const tokenizer = {
            type: '@node-rs/jieba',
            segment: text => extractTokenWords(cutFn(text))
          }
          if (isTokenizerUsable(tokenizer)) return tokenizer
        }
      } catch {}

      // 2. 尝试使用 nodejieba
      try {
        const mod = await import('nodejieba')
        const jieba = mod.default || mod
        if (jieba?.tag) {
          const tokenizer = {
            type: 'nodejieba',
            segment: text => jieba.tag(text)
              .map(parseTaggedToken)
              .filter(item => {
                const tag = item.tag || ''
                return !REJECT_POS_PREFIX.some(prefix => tag.startsWith(prefix))
              })
              .map(item => item.word)
          }
          if (isTokenizerUsable(tokenizer)) return tokenizer
        }
        if (jieba?.cut) {
          const tokenizer = {
            type: 'nodejieba',
            segment: text => extractTokenWords(jieba.cut(text, true))
          }
          if (isTokenizerUsable(tokenizer)) return tokenizer
        }
      } catch {}

      // 3. 原生兜底：Intl.Segmenter
      return null
    })()
  }
  return tokenizerPromise
}

/**
 * 清洗消息文本
 */
export function cleanText (text) {
  if (!text) return ''
  return String(text)
    // 过滤机器人指令前缀
    .replace(/^[#/!][\s\S]*$/gm, '')
    // 过滤 CQ 码与特殊消息结构
    .replace(/\[CQ:[^\]]+\]/g, '')
    .replace(/\{at:[^}]+\}/g, '')
    .replace(/\{image:[^}]+\}/g, '')
    // 过滤 URL 与 邮箱
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/[\w.-]+@[\w.-]+\.\w+/g, '')
    // 过滤 XML / JSON 片段
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<msg[\s\S]*?<\/msg>/gi, '')
    .replace(/\{"app":[\s\S]*?\}/g, '')
    // 过滤纯 Emoji 与图形符号
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    // 过滤常见特殊符号，保留文字、数字与连字
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    // 压缩连续单字刷屏（例如 哈哈哈哈哈 -> 哈哈, 卧槽槽槽 -> 卧槽）
    .replace(/(.)\1{3,}/gu, '$1$1')
    .trim()
}

/**
 * 对单条文本进行分词与精细过滤
 */
export function tokenize (text, tokenizer) {
  const cleaned = cleanText(text)
  if (!cleaned) return []

  let words = []
  if (tokenizer?.segment) {
    words = tokenizer.segment(cleaned)
  } else if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
    for (const item of segmenter.segment(cleaned)) {
      if (item.isWordLike) words.push(item.segment)
    }
  } else {
    words.push(...cleaned.split(/\s+/))
  }

  return words.map(word => normalizeWord(word))
    .filter(Boolean)
    // 词长限制：至少2个字符，且不超过12个字符
    .filter(word => word.length >= 2 && word.length <= 12)
    // 排除纯数字（如 12345、2024）
    .filter(word => !/^\d+$/.test(word))
    // 排除 16 进制或无意义哈希
    .filter(word => !/^0x[0-9a-f]+$/i.test(word))
    // 排除单字母
    .filter(word => !/^[a-z]$/i.test(word))
    // 过滤乱码与非法符号
    .filter(word => !/[□■\u25a0-\u25ff\ud800-\udfff]/u.test(word))
    // 停用词库过滤
    .filter(word => !STOP_WORDS.has(word))
}

export function isTokenizerUsable (tokenizer) {
  try {
    const sample = '我喜欢搜索图片和模型配置，也会聊游戏、代码和聊天记录'
    const words = tokenizer.segment(sample).map(word => normalizeWord(word)).filter(Boolean)
    return words.some(word => /^[\p{Script=Han}]{2,}$/u.test(word))
  } catch (err) {
    const log = global.logger || console
    log.warn?.(`[chronicle-plugin] ${tokenizer.type} 分词器自检失败:`, err)
    return false
  }
}

function parseTaggedToken (item) {
  if (Array.isArray(item)) return { word: String(item[0] || ''), tag: String(item[1] || '') }
  if (typeof item === 'object' && item) {
    return {
      word: String(item.word || item.value || item.text || ''),
      tag: String(item.tag || item.pos || item.flag || '')
    }
  }
  return { word: String(item || ''), tag: '' }
}

function extractTokenWords (items) {
  if (!Array.isArray(items)) return []
  return items.map(item => {
    if (typeof item === 'string') return item
    if (Array.isArray(item)) return item[0]
    if (typeof item === 'object' && item) return item.word || item.value || item.text || ''
    return ''
  })
}

export function normalizeWord (word) {
  word = String(word || '').trim().toLowerCase()
  if (!word) return ''
  if (word.startsWith('@')) return ''
  word = word.replace(/^@+/, '')
  return word
}

/**
 * 组装供模板渲染的精美词云数据
 */
export function prepareWordCloud (words, options = {}) {
  const isCompact = typeof options === 'boolean' ? options : Boolean(options.isToday)
  // 精致现代调色盘：活力、高对比度、视觉舒适的色彩组合
  const palette = [
    '#4f46e5', // Electric Indigo
    '#0284c7', // Cyan Sky
    '#059669', // Emerald
    '#d97706', // Amber Gold
    '#e11d48', // Coral Rose
    '#7c3aed', // Royal Violet
    '#0d9488', // Deep Teal
    '#c026d3', // Fuchsia
    '#ea580c', // Bright Orange
    '#2563eb'  // Ocean Blue
  ]

  const max = words[0]?.count || 1
  const min = words[words.length - 1]?.count || 1

  const processedWords = words.map(item => {
    // 平滑非线性缩放：使用开方比例使得长尾词不至于过小，核心热词突出
    const rate = max === min ? 1 : (item.count - min) / (max - min)
    const minSize = isCompact ? 16 : 15
    const maxSize = isCompact ? 58 : 68
    const size = Math.round(minSize + Math.pow(rate, 0.55) * (maxSize - minSize))
    const color = palette[hashInt(item.text) % palette.length]

    return {
      text: item.text,
      count: item.count,
      size,
      color
    }
  })

  // 生成 TOP 10 热词排行数据（含相对占比）
  const topWords = processedWords.slice(0, 10).map((item, index) => ({
    rank: index + 1,
    text: item.text,
    count: item.count,
    color: item.color,
    percent: Math.round((item.count / max) * 100)
  }))

  const totalCount = processedWords.reduce((sum, item) => sum + item.count, 0)

  return {
    words: processedWords,
    wordsJson: JSON.stringify(processedWords),
    topWords,
    maxCount: max,
    totalCount,
    wordCount: processedWords.length
  }
}

export function hashInt (text) {
  return crypto.createHash('md5').update(String(text)).digest().readUInt32BE(0)
}
