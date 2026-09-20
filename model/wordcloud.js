import crypto from 'node:crypto'

const STOP_WORDS = new Set([
  '一个', '这个', '那个', '这些', '那些', '什么', '怎么', '不是', '没有', '还是', '可以', '感觉', '已经', '就是', '这么', '这么说',
  '真的', '然后', '因为', '所以', '但是', '如果', '现在', '今天', '明天', '昨天', '时候', '一下', '一点', '一样', '的话',
  '我们', '你们', '他们', '自己', '大家', '有人', '东西', '问题', '不会', '不能', '不要', '这样', '那样', '哈哈', '哈哈哈',
  '你的', '我的', '他的', '她的', '它的', '你是', '我是', '都是', '也是', '又在', '还有', '只有', '直接', '一直', '不过',
  '这种', '那种', '应该', '可能', '需要', '出来', '起来', '里面', '这里', '那里', '之前', '之后', '刚才', '突然', '确实',
  '继续', '变成', '收到', '每天', '进行', '开始', '结束', '最后', '所有', '任何', '多少', '为什么', '是不是', '不能够',
  '知道', '看看', '说话', '消息', '文本', '内容', '表情', '名字',
  'http', 'https', 'com', 'www',
  'the', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'no', 'not', 'new', 'type', 'id', 'key', 'text', 'message', 'status',
  'request', 'response', 'token', 'param', 'import', 'upstream'
])

const REJECT_POS_PREFIX = ['r', 'p', 'c', 'u', 'y', 'e', 'o', 'w', 'm', 'q', 'd', 'f']
const KEEP_ENGLISH_WORDS = new Set([
  'ai', 'gpt', 'claude', 'gemini', 'openai', 'deepseek', 'codex', 'linuxdo',
  'api', 'bot', 'bug', 'error', 'code', 'node', 'sqlite', 'plugin', 'plugins',
  'meilisearch', 'jieba', 'token', 'prompt', 'model', 'docker', 'pm2'
])

let tokenizerPromise = null

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

export async function getTokenizer () {
  if (!tokenizerPromise) {
    tokenizerPromise = (async () => {
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

      try {
        const mod = await import('@node-rs/jieba')
        const cutFn = mod.cut || mod.default?.cut
        if (cutFn) {
          const tokenizer = {
            type: '@node-rs/jieba',
            segment: text => extractTokenWords(cutFn(text))
          }
          if (isTokenizerUsable(tokenizer)) return tokenizer
        }
        const JiebaClass = mod.Jieba || (typeof mod.default === 'function' ? mod.default : null)
        if (JiebaClass) {
          const jieba = new JiebaClass()
          if (jieba?.cut) {
            const tokenizer = {
              type: '@node-rs/jieba',
              segment: text => extractTokenWords(jieba.cut(text))
            }
            if (isTokenizerUsable(tokenizer)) return tokenizer
          }
        }
      } catch {}

      return null
    })()
  }
  return tokenizerPromise
}

export function tokenize (text, tokenizer) {
  text = String(text || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/#\S+/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/[^\p{L}\p{N}@]+/gu, ' ')

  let words = []
  if (tokenizer?.segment) {
    words = tokenizer.segment(text)
  } else if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('zh', { granularity: 'word' })
    for (const item of segmenter.segment(text)) {
      if (item.isWordLike) words.push(item.segment)
    }
  } else {
    words.push(...text.split(/\s+/))
  }

  return words.map(word => normalizeWord(word))
    .filter(Boolean)
    .filter(word => word.length >= 2)
    .filter(word => !/^\d+$/.test(word))
    .filter(word => !/^[a-z]$/i.test(word))
    .filter(word => /^[\p{Script=Han}a-z0-9]+$/iu.test(word))
    .filter(word => !/^[\p{Script=Han}]$/u.test(word))
    .filter(word => !/^[a-z0-9]+$/i.test(word) || KEEP_ENGLISH_WORDS.has(word))
    .filter(word => !/[□■\u25a0-\u25ff\ud800-\udfff]/u.test(word))
    .filter(word => !STOP_WORDS.has(word))
}

export function isTokenizerUsable (tokenizer) {
  try {
    const sample = '我喜欢搜索图片和模型配置，也会聊游戏、代码和聊天记录'
    const words = tokenizer.segment(sample).map(word => normalizeWord(word)).filter(Boolean)
    return words.some(word => /^[\p{Script=Han}]{2,}$/u.test(word))
  } catch (err) {
    const log = global.logger || console
    log.warn?.(`${tokenizer.type} 分词器自检失败`, err)
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

export function prepareWordCloud (words, compact = false) {
  const palette = ['#125c77', '#b23a48', '#2d7d46', '#8a5a00', '#5b4a9c', '#c2572b', '#2364aa', '#6f5f2f']
  const max = words[0]?.count || 1
  const min = words[words.length - 1]?.count || 1
  return words.map(item => {
    const rate = max === min ? 1 : (item.count - min) / (max - min)
    const size = Math.round((compact ? 18 : 16) + Math.pow(rate, 0.5) * (compact ? 44 : 50))
    const rotate = 0
    const color = palette[hashInt(item.text + item.count) % palette.length]
    return {
      text: item.text,
      count: item.count,
      size,
      rotate,
      color
    }
  })
}

export function hashInt (text) {
  return crypto.createHash('md5').update(String(text)).digest().readUInt32BE(0)
}
