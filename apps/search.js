import fs from 'node:fs'
import path from 'node:path'
import _ from 'lodash'
import common from '../../../lib/common/common.js'
import plugin from '../../../lib/plugins/plugin.js'

import Config from '../model/config.js'
import MeiliClient from '../model/meiliClient.js'
import { callChat } from '../model/ai.js'
import { buildWordCloudWords, prepareWordCloud } from '../model/wordcloud.js'
import { renderWordCloud, renderPersonalAtGraph, renderAtGraph } from '../model/renderer.js'
import {
  getGroupAtGraph,
  isGraphCached,
  buildAtGraphRenderData,
  buildPersonalAtGraphRenderData
} from '../model/atgraph.js'

const DEFAULT_PAGE_SIZE = 50
const IMAGE_PAGE_SIZE = 30
const BQB_PAGE_SIZE = 20

export class Search extends plugin {
  constructor () {
    super({
      name: 'meilisearch-search',
      dsc: 'Meilisearch 群聊搜索与数据分析指令',
      event: 'message',
      priority: 5000,
      rule: [
        {
          reg: '^#(全部)?搜索(图片|表情包)',
          fnc: 'getBqb',
          priority: '-1000000'
        },
        {
          reg: '^#(我|他|她|TA)的发言',
          fnc: 'getFy',
          priority: '-1000000'
        },
        {
          reg: '^#搜索(我的)?(发言|消息)',
          fnc: 'searchFy',
          priority: '-1000000'
        },
        {
          reg: '^#总结(全部)?tag',
          fnc: 'tagsAggr',
          priority: '-1000000'
        },
        {
          reg: '^#总结(全部)?发言',
          fnc: 'msgAggr',
          priority: '-1000000'
        },
        {
          reg: '^#总结(全部)?表情包',
          fnc: 'bqbAggr',
          priority: '-1000000'
        },
        {
          reg: '^#(全部)?(图片|表情包)(溯源|统计|记录)',
          fnc: 'imageTrace',
          priority: '-1000000'
        },
        {
          reg: '^#(谁发过|谁用过)(这张图|这个图|这张图片|这个表情包)?',
          fnc: 'imageTrace',
          priority: '-1000000'
        },
        {
          reg: '^#(艾特|at)(统计|排行)',
          fnc: 'atStats',
          priority: '-1000000'
        },
        {
          reg: '^#(被艾特排行|最爱艾特排行)',
          fnc: 'atStats',
          priority: '-1000000'
        },
        {
          reg: '^#谁最喜欢(艾特|at)(我|他|她|TA)?',
          fnc: 'atTargetRank',
          priority: '-1000000'
        },
        {
          reg: '^#(我的|个人|他|她|ta|TA|随机)?(的)?(艾特|at)(图谱|关系)',
          fnc: 'atGraph',
          priority: '-1000000'
        },
        {
          reg: '^#(今日|今天)?(随机|群|个人)?词云',
          fnc: 'wordCloud',
          priority: '-1000000'
        },
        {
          reg: '^#tag',
          fnc: 'tag'
        },
        {
          reg: '^#谁(艾特|at)(我|他|她)',
          fnc: 'whoAt'
        },
        {
          reg: '^#query',
          fnc: 'query',
          priority: '-1000000',
          permission: 'master'
        },
        {
          reg: '^#(debug)?(随机)?学舌',
          fnc: 'repeat'
        },
        {
          reg: '^#(debug)?(随机)?画像',
          fnc: 'descriptionUser'
        },
        {
          reg: '^#群画像',
          fnc: 'descriptionGroup'
        }
      ]
    })

    // 动态包装所有指令执行函数，统一检查分群启用状态
    for (const r of this.rule || []) {
      const fncName = r.fnc
      const origFnc = this[fncName]
      if (typeof origFnc === 'function' && !origFnc._wrapped) {
        this[fncName] = async function (e) {
          if (e.isGroup && !Config.isGroupEnabled(e.group_id)) {
            return false
          }
          return origFnc.call(this, e)
        }
        this[fncName]._wrapped = true
      }
    }
  }

  async getBqb (e) {
    const { text, page } = parsePageCommand(e.msg)
    let query = text.replace(/#(全部)?搜索(图片|表情包)/, '').trim()
    let asface = text.includes('搜索表情包')
    let groupId = e.group?.group_id
    if (e.msg.includes('全部')) {
      groupId = null
    }

    let filter = asface ? '(message.type = "image" OR message.type = "bface")' : 'message.type = "image"'
    if (groupId) {
      filter += ` AND group.group_id = ${groupId}`
    }

    const index = MeiliClient.getIndex()
    const results = await index.search(query, {
      filter,
      limit: IMAGE_PAGE_SIZE,
      offset: (page - 1) * IMAGE_PAGE_SIZE,
      sort: ['quotable.time:desc'],
      attributesToSearchOn: ['message.summary', 'message.description', 'message.tags']
    })

    let total = getTotal(results)
    let images = new Set()
    let elems = []
    for (let msg of results.hits || []) {
      let file = msg.message?.find(item => item.type === 'image')?.file
      if (file) images.add(file)
    }

    const cfg = Config.getConfig().storage || {}
    const receivedDir = cfg.receivedDir || './data/chronicle/received'

    for (let img of images) {
      try {
        let absPath = path.resolve(process.cwd(), receivedDir, img)
        let buffer = fs.readFileSync(absPath)
        let imgElem = segment.image(buffer)
        elems.push(imgElem)
      } catch (err) {
        logger.warn?.(err)
      }
    }

    if (elems.length === 0) {
      await e.reply('没有找到' + (asface ? '表情包' : '图片'))
      return
    }

    elems.push(`总数：${total}\n${formatPageInfo(page, IMAGE_PAGE_SIZE, total)}`)
    let forward = await common.makeForwardMsg(e, elems, asface ? '搜索表情包' : '搜索图片')
    await e.reply(forward)
  }

  async getFy (e) {
    const { text, page } = parsePageCommand(e.msg)
    let qq
    if (text.includes('我')) {
      qq = e.sender.user_id
    } else {
      qq = e.message.find(item => item.type === 'at')?.qq
      if (!qq) {
        await e.reply('请@一个人')
        return
      }
    }

    let gid = text.replace(/#(我|他|她|TA)的发言/, '').trim()
    let groupId = gid || e.group?.group_id
    if (text.includes('全部')) {
      groupId = null
    }

    let filter = `sender.user_id = ${qq}`
    if (groupId) {
      filter += ` AND group.group_id = ${groupId}`
    }

    const user = global.Bot?.gml?.get(e.group?.group_id)?.get(qq)
    const name = user?.card || user?.nickname || qq
    const results = await MeiliClient.getIndex().search('', {
      filter,
      limit: DEFAULT_PAGE_SIZE,
      offset: (page - 1) * DEFAULT_PAGE_SIZE,
      sort: ['quotable.time:desc']
    })

    let messages = await handleHits(results)
    if (messages.length === 0) {
      await e.reply('没有找到发言')
      return
    }

    e.sender.card = user?.card || user?.nickname || name
    e.user_id = qq
    let forward = await makeForwardMsg(e, messages, `${name}的发言 ${formatPageInfo(page, DEFAULT_PAGE_SIZE, getTotal(results))}`, true)
    await e.reply(forward)
  }

  async searchFy (e) {
    const { text, page } = parsePageCommand(e.msg)
    let qq
    if (text.includes('搜索我的')) {
      qq = e.sender.user_id
    } else {
      qq = e.message.find(item => item.type === 'at')?.qq
    }

    let query = text.replace(/#搜索(我的)?(发言|消息)/, '').trim()
    let groupId = e.group?.group_id

    let filter = `group.group_id = ${groupId}`
    if (qq) {
      filter += ` AND sender.user_id = ${qq}`
    }
    if (!query) {
      await e.reply('🙅请输入搜索内容，例如#搜索发言 晚上好')
      return
    }

    const user = global.Bot?.gml?.get(e.group?.group_id)?.get(qq)
    const name = user?.card || user?.nickname || qq
    const results = await MeiliClient.getIndex().search(query, {
      filter,
      limit: DEFAULT_PAGE_SIZE,
      offset: (page - 1) * DEFAULT_PAGE_SIZE,
      sort: ['quotable.time:desc'],
      attributesToSearchOn: ['message.text', 'json.data', 'message.summary', 'message.description', 'message.tags'],
      matchingStrategy: 'all',
      rankingScoreThreshold: 0.6
    })

    let messages = await handleHits(results)
    if (messages.length === 0) {
      await e.reply('没有找到发言')
      return
    }

    if (user) {
      e.sender.card = user.card || user.nickname
      e.user_id = qq
    }
    let forward = await makeForwardMsg(e, messages, `${name}的发言 ${formatPageInfo(page, DEFAULT_PAGE_SIZE, getTotal(results))}`, true)
    await e.reply(forward)
  }

  async tagsAggr (e) {
    const { text, page } = parsePageCommand(e.msg)
    let all = text.includes('全部')
    let filter = ''
    if (!all && e.group?.group_id) {
      filter = `group.group_id = ${e.group.group_id}`
    }

    let aggr = await MeiliClient.facetAggr('message.tags', filter, Math.max(DEFAULT_PAGE_SIZE * page, DEFAULT_PAGE_SIZE))
    const total = aggr.facetHits.length
    let values = aggr.facetHits.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE).map(hit => {
      return `${hit.value} (${hit.count}次)`
    })

    let str = `${formatPageInfo(page, DEFAULT_PAGE_SIZE, total)}\n\n${values.join('\n')}`
    let msg = await common.makeForwardMsg(e, [str], 'tag次数排行')
    e.reply(msg)
  }

  async msgAggr (e) {
    const { text, page } = parsePageCommand(e.msg)
    let all = text.includes('全部')
    let filter = ''
    if (!all && e.group?.group_id) {
      filter = `group.group_id = ${e.group.group_id}`
    }

    let aggr = await MeiliClient.facetAggr('sender.user_id', filter, Math.max(DEFAULT_PAGE_SIZE * page, DEFAULT_PAGE_SIZE))
    const total = aggr.facetHits.length
    let values = await Promise.all(aggr.facetHits.slice((page - 1) * DEFAULT_PAGE_SIZE, page * DEFAULT_PAGE_SIZE).map(async hit => {
      const name = await MeiliClient.getDisplayName(e, hit.value, all)
      return `${name} (${hit.value})：${hit.count}次`
    }))

    let str = `${formatPageInfo(page, DEFAULT_PAGE_SIZE, total)}\n\n${values.join('\n')}`
    let msg = await common.makeForwardMsg(e, [str], '发言排行')
    e.reply(msg)
  }

  async bqbAggr (e) {
    const { text, page } = parsePageCommand(e.msg)
    let all = text.includes('全部')
    let bqbFilter = '(message.asface = true OR message.type = "bface")'
    if (!all && e.group?.group_id) {
      bqbFilter += ` AND group.group_id = ${e.group.group_id}`
    }

    const cfg = Config.getConfig().storage || {}
    const receivedDir = cfg.receivedDir || './data/chronicle/received'

    let aggr = await MeiliClient.facetAggr('message.file', bqbFilter, Math.max(BQB_PAGE_SIZE * page, BQB_PAGE_SIZE))
    const total = aggr.facetHits.length
    let values = await Promise.all(aggr.facetHits.slice((page - 1) * BQB_PAGE_SIZE, page * BQB_PAGE_SIZE).map(async hit => {
      let imgElem
      try {
        let absPath = path.resolve(process.cwd(), receivedDir, hit.value)
        let buffer = fs.readFileSync(absPath)
        imgElem = segment.image(buffer)
      } catch (err) {
        imgElem = hit.value + ' (图片资源丢失)'
      }

      let senderFilter = `message.file = "${escapeFilterString(hit.value)}"`
      if (!all && e.group?.group_id) {
        senderFilter += ` AND group.group_id = ${e.group.group_id}`
      }
      let res = await MeiliClient.facetAggr('sender.user_id', senderFilter, 100)
      let qq = res.facetHits[0]?.value
      let name = qq ? await MeiliClient.getDisplayName(e, qq, all) : ''
      return [
        imgElem,
        qq ? `${hit.count}次 (最喜欢发这个表情包的人是${name} ${qq})` : `${hit.count}次`
      ]
    }))

    values.push(formatPageInfo(page, BQB_PAGE_SIZE, total))
    let msg = await common.makeForwardMsg(e, values, '表情包排行')
    e.reply(msg)
  }

  async imageTrace (e) {
    const pageArg = parsePageCommand(e.msg)
    const page = pageArg.page
    const all = e.msg.includes('全部')
    const image = await getTargetImage(e)
    if (!image) {
      await e.reply('请引用一张图片，或在指令后直接带上图片')
      return
    }

    const imageFilter = image.md5
      ? `message.md5 = "${escapeFilterString(image.md5)}"`
      : `message.file = "${escapeFilterString(image.file)}"`
    let filter = `message.type = "image" AND ${imageFilter}`
    if (!all && e.group?.group_id) {
      filter += ` AND group.group_id = ${e.group.group_id}`
    }

    const index = MeiliClient.getIndex()
    const [recent, aggr] = await Promise.all([
      index.search('', {
        filter,
        limit: DEFAULT_PAGE_SIZE,
        offset: (page - 1) * DEFAULT_PAGE_SIZE,
        sort: ['quotable.time:desc']
      }),
      index.search('', {
        filter,
        facets: ['sender.user_id'],
        limit: 1
      })
    ])

    const total = getTotal(recent)
    if (!total) {
      await e.reply('没有找到这张图的历史记录')
      return
    }

    const counts = Object.entries(aggr.facetDistribution?.['sender.user_id'] || {})
      .map(([qq, count]) => ({ qq, count }))
      .sort((a, b) => b.count - a.count)

    const ranking = await Promise.all(counts.map(async (item, idx) => {
      const name = await MeiliClient.getDisplayName(e, item.qq, all)
      return `${idx + 1}. ${name} (${item.qq})：${item.count}次`
    }))

    const recentLines = recent.hits.map((hit, idx) => {
      const no = (page - 1) * DEFAULT_PAGE_SIZE + idx + 1
      const name = hit.sender?.card || hit.sender?.nickname || getMemberName(e, hit.sender?.user_id)
      return `${no}. ${formatDate(new Date(hit.quotable.time * 1000))} ${name} (${hit.sender?.user_id})`
    })

    const cfg = Config.getConfig().storage || {}
    const receivedDir = cfg.receivedDir || './data/chronicle/received'

    const elems = []
    try {
      const file = image.file || recent.hits[0]?.message?.find(item => item.type === 'image')?.file
      if (file) {
        elems.push(segment.image(fs.readFileSync(path.resolve(process.cwd(), receivedDir, file))))
      }
    } catch (err) {
      logger.warn?.(err)
    }

    elems.push(`图片历史统计${all ? '（全部群）' : ''}\n总次数：${total}\n发送人数：${counts.length}\n${formatPageInfo(page, DEFAULT_PAGE_SIZE, total)}`)
    elems.push(`每个人发送次数：\n${ranking.join('\n') || '暂无'}`)
    elems.push(`最近发送记录：\n${recentLines.join('\n') || '暂无'}`)

    const msg = await common.makeForwardMsg(e, elems, '图片溯源')
    await e.reply(msg)
  }

  async atStats (e) {
    const page = parsePageCommand(e.msg).page
    const all = e.msg.includes('全部')
    const mode = e.msg.includes('被艾特') ? 'target' : e.msg.includes('最爱艾特') ? 'sender' : 'both'
    let filter = 'message.type = "at"'
    if (!all && e.group?.group_id) {
      filter += ` AND group.group_id = ${e.group.group_id}`
    }

    const index = MeiliClient.getIndex()
    const res = await index.search('', {
      filter,
      facets: ['sender.user_id', 'message.qq'],
      limit: 1
    })

    const senderRank = await MeiliClient.facetRank(res, 'sender.user_id', e, page, DEFAULT_PAGE_SIZE, all)
    const targetRank = await MeiliClient.facetRank(res, 'message.qq', e, page, DEFAULT_PAGE_SIZE, all)

    const elems = []
    if (mode !== 'target') {
      elems.push(`最爱艾特别人：\n${senderRank.lines.join('\n') || '暂无'}`)
    }
    if (mode !== 'sender') {
      elems.push(`最常被艾特：\n${targetRank.lines.join('\n') || '暂无'}`)
    }
    elems.push(`统计范围：${all ? '全部群' : '本群'}\n${formatPageInfo(page, DEFAULT_PAGE_SIZE, mode === 'target' ? targetRank.total : senderRank.total)}`)

    const msg = await common.makeForwardMsg(e, elems, '艾特统计')
    await e.reply(msg)
  }

  async atTargetRank (e) {
    const page = parsePageCommand(e.msg).page
    let qq
    if (e.msg.includes('我')) {
      qq = e.sender.user_id
    } else {
      qq = e.message.find(item => item.type === 'at')?.qq
    }
    if (!qq) {
      await e.reply('请@要统计的人，或使用“#谁最喜欢艾特我”')
      return
    }

    const filter = `group.group_id = ${e.group.group_id} AND message.type = "at" AND message.qq = ${qq}`
    const res = await MeiliClient.getIndex().search('', {
      filter,
      facets: ['sender.user_id'],
      limit: 1
    })

    const rank = await MeiliClient.facetRank(res, 'sender.user_id', e, page, DEFAULT_PAGE_SIZE)
    const targetName = await MeiliClient.getDisplayName(e, qq)
    const text = `谁最喜欢艾特 ${targetName} (${qq})：\n${rank.lines.join('\n') || '暂无'}\n\n${formatPageInfo(page, DEFAULT_PAGE_SIZE, rank.total)}`
    const msg = await common.makeForwardMsg(e, [text], '艾特对象排行')
    await e.reply(msg)
  }

  async atGraph (e) {
    const groupId = e.group?.group_id
    if (!groupId) {
      await e.reply('请在群聊中使用该指令')
      return
    }

    let targetQq = null
    const isRandom = e.msg.includes('随机')
    const atItem = e.message?.find(item => item.type === 'at')
    if (atItem && atItem.qq) {
      targetQq = String(atItem.qq)
    } else {
      const numMatch = e.msg.replace(/^#(我的|个人|他|她|ta|TA|随机)?(的)?(艾特|at)(图谱|关系)/i, '').match(/\d{5,12}/)
      if (numMatch) {
        targetQq = numMatch[0]
      } else if (isRandom) {
        targetQq = '__RANDOM__'
      } else if (e.msg.includes('我') || e.msg.startsWith('#我的') || e.msg.startsWith('#个人')) {
        targetQq = String(e.sender.user_id)
      }
    }

    const graphCacheKey = String(groupId)
    if (!isGraphCached(graphCacheKey)) {
      await e.reply('正在生成艾特关系图，首次统计需要扫描全群消息，请稍等…', true)
    }

    try {
      const cfg = Config.getConfig().meilisearch || {}
      const graph = await getGroupAtGraph(cfg, groupId)
      if (!graph.nodes.length || !graph.edges.length) {
        await e.reply('这个群还没有艾特记录呢')
        return
      }

      if (targetQq === '__RANDOM__') {
        const candidates = graph.nodes.filter(n => (n.in + n.out) > 0)
        if (candidates.length === 0) {
          await e.reply('当前群内暂无可供展示的艾特关系数据')
          return
        }
        const activeCandidates = candidates.filter(n => (n.in + n.out) >= 2)
        const pool = activeCandidates.length > 0 ? activeCandidates : candidates
        const picked = pool[Math.floor(Math.random() * pool.length)]
        targetQq = String(picked.id)
      }

      if (targetQq) {
        const data = buildPersonalAtGraphRenderData(graph, targetQq, {
          groupName: e.group?.group_name || e.group?.name || String(groupId),
          isRandom
        })
        if (!data) {
          await e.reply(`群友 (${targetQq}) 在本群暂无艾特互动记录`)
          return
        }
        const img = await renderPersonalAtGraph(e, data)
        if (img) {
          await e.reply(img)
        } else {
          await e.reply('个人图谱生成失败，请查看后台日志')
        }
      } else {
        const data = buildAtGraphRenderData(graph, {
          groupName: e.group?.group_name || e.group?.name || String(groupId)
        })
        const img = await renderAtGraph(e, data)
        if (img) {
          await e.reply(img)
        } else {
          await e.reply('图谱生成失败，请查看后台日志')
        }
      }
    } catch (err) {
      logger.error('艾特关系图生成失败', err)
      await e.reply('图谱生成失败，请查看后台日志')
    }
  }

  async wordCloud (e) {
    const { text } = parsePageCommand(e.msg)
    const isToday = text.includes('今日') || text.includes('今天')
    const isRandom = text.includes('随机')
    const isGroupCloud = !isRandom && !text.includes('个人')
    let qq = null
    let randomCount = 0
    const todayStart = getTodayStartSeconds()
    const timeFilter = isToday ? ` AND quotable.time >= ${todayStart}` : ''

    if (!isRandom && !isGroupCloud) {
      qq = e.message.find(item => item.type === 'at')?.qq || e.sender.user_id
    }

    const wcConf = Config.getConfig().wordcloud || {}
    const defaultLimit = isToday ? (wcConf.todayLimit || 5000) : (wcConf.historyLimit || 50000)
    const wordLimit = isToday ? (wcConf.todayWords || 100) : (wcConf.historyWords || 130)
    let limit = parseLimit(text, defaultLimit, wcConf.maxLimit || 500000)

    let filter = `group.group_id = ${e.group.group_id} AND message.type = "text"${timeFilter}`
    if (qq) {
      filter += ` AND sender.user_id = ${qq}`
    }

    let hits = await MeiliClient.fetchWordCloudDocuments(filter, limit)
    if (isRandom) {
      const counts = new Map()
      for (const hit of hits) {
        const userId = String(hit.sender?.user_id || '')
        if (!userId) continue
        counts.set(userId, (counts.get(userId) || 0) + 1)
      }
      const candidates = [...counts.entries()]
        .map(([q, count]) => ({ qq: q, count }))
        .filter(item => item.count >= (isToday ? 5 : 20))
      if (candidates.length === 0) {
        await e.reply(isToday ? '今天文本记录太少，暂时随机不出词云' : '当前群组文本记录太少，暂时随机不出词云')
        return
      }
      const picked = candidates[Math.floor(Math.random() * candidates.length)]
      qq = picked.qq
      randomCount = picked.count
      hits = hits.filter(hit => String(hit.sender?.user_id) === String(qq))
    }

    const texts = hits.map(hit => extractText(hit)).filter(Boolean)
    const words = await buildWordCloudWords(texts)
    if (words.length === 0) {
      await e.reply('文本太少，暂时生成不了词云')
      return
    }

    const name = qq ? await MeiliClient.getDisplayName(e, qq) : ''
    const title = isGroupCloud
      ? `${e.group.name || e.group.group_name || e.group.group_id} ${isToday ? '今日词云' : '历史词云'}`
      : `${isRandom ? '随机抽中 ' : ''}${name} ${isToday ? '今日词云' : '历史词云'}`
    const subtitle = isRandom
      ? `候选发言 ${randomCount} 条 / ${isToday ? '今日' : '历史全部扫描'} ${texts.length} 条 / ${words.length} 个词条`
      : `${isToday ? '今日' : '历史全部扫描'} ${texts.length} 条文本消息 / ${words.length} 个词条`

    const prepared = prepareWordCloud(words.slice(0, wordLimit), { isToday })

    const image = await renderWordCloud(e, {
      title,
      subtitle,
      ...prepared,
      messageCount: texts.length,
      generatedTime: formatDate(new Date()),
      width: 1060,
      height: isToday ? 680 : 740
    })

    if (image) {
      await e.reply(image)
    } else {
      const fallback = words.slice(0, 50).map((word, idx) => `${idx + 1}. ${word.text} (${word.count})`).join('\n')
      const msg = await common.makeForwardMsg(e, [fallback], title)
      await e.reply(msg)
    }
  }

  async tag (e) {
    const { text } = parsePageCommand(e.msg)
    const tag = text.replace(/^#tag/, '').trim()
    let tags = tag.split(/[,，]/).map(item => item.trim()).filter(Boolean)
    let image

    if (e.source) {
      let reply
      let seq = e.isGroup ? e.source.seq : e.source.time
      if (e.isGroup) {
        reply = (await e.group.getChatHistory(seq, 1)).pop()?.message
      } else {
        reply = (await e.friend.getChatHistory(seq, 1)).pop()?.message
      }
      if (reply) {
        image = reply.find(item => item.type === 'image')
      }
    }

    if (!image) {
      image = e.message.find(item => item.type === 'image')
    }

    if (!image) {
      e.reply('请选择一张图片或者回复一张图片')
      return
    }

    let file = image.file
    let records = await MeiliClient.getIndex().search('', {
      filter: `message.type = "image" AND message.file = "${file}"`
    })

    if (tags.length === 0) {
      let hit = records.hits.find(item => {
        return Array.isArray(item.message) && item.message?.find(i => i.tags)
      })
      if (!hit) {
        e.reply('当前无此图片tag，请稍后再试')
        return
      }
      let img = hit.message?.find(item => item.tags)
      let currentTags = img.tags || []
      let description = img.description
      let msg = `Tags: ${currentTags.join(', ')}`
      if (description) {
        msg += `\n\n${description}`
      }
      e.reply(msg, true)
      return
    }

    let toUpdate = []
    for (let hit of records.hits) {
      hit.message?.forEach(item => {
        if (item.file === file) {
          if (item.tags) {
            let newTags = new Set(item.tags)
            tags.forEach(t => newTags.add(t))
            item.tags = Array.from(newTags)
          } else {
            item.tags = tags
          }
        }
      })
      toUpdate.push(hit)
    }

    await MeiliClient.getIndex().addDocuments(toUpdate)
    e.reply('操作成功')
  }

  async whoAt (e) {
    const { text, page } = parsePageCommand(e.msg)
    let num = text.replace(/^#谁(艾特|at)(我|他|她)/, '').trim() || String(DEFAULT_PAGE_SIZE)
    try {
      num = parseInt(num)
    } catch {
      num = DEFAULT_PAGE_SIZE
    }
    if (!num || Number.isNaN(num)) num = DEFAULT_PAGE_SIZE

    let qq
    if (text.includes('我')) {
      qq = e.sender.user_id
    } else {
      qq = e.message.find(item => item.type === 'at')?.qq
    }
    if (!qq) {
      await e.reply('请@要查询的人，或使用“#谁艾特我”')
      return
    }

    let result = await MeiliClient.getIndex().search('', {
      filter: `group.group_id = ${e.group.group_id} AND message.type = "at" AND message.qq = ${qq}`,
      limit: num,
      offset: (page - 1) * num,
      sort: ['quotable.time:desc']
    })

    const msg = await handleHits(result)
    const f = await makeForwardMsg(e, msg, `${text} ${formatPageInfo(page, num, getTotal(result))}`, true)
    e.reply(f)
  }

  async query (e) {
    const { text, page } = parsePageCommand(e.msg)
    const query = text.replace(/#query/, '').trim()
    let [q = '', o = '{}'] = query.split('/')
    if (!o) o = '{}'

    function evaluateTemplateString (template) {
      return template.replace(/\$\{([^}]+)\}/g, (_, expression) => {
        try {
          return new Function('e', `return (${expression});`)(e)
        } catch (error) {
          console.error(`Error evaluating expression "${expression}":`, error)
          return ''
        }
      })
    }

    o = evaluateTemplateString(o)
    let opt = JSON.parse(o)
    let option = {
      limit: DEFAULT_PAGE_SIZE,
      offset: (page - 1) * DEFAULT_PAGE_SIZE,
      sort: ['quotable.time:desc'],
      attributesToSearchOn: ['message.text', 'json.data', 'message.summary', 'message.description', 'message.tags'],
      matchingStrategy: 'all',
      rankingScoreThreshold: 0.6
    }
    option = Object.assign(option, opt)

    const results = await MeiliClient.getIndex().search(q, option)
    let messages = await handleHits(results)
    if (messages.length === 0) {
      await e.reply('没有找到发言')
      return
    }

    let forward = await makeForwardMsg(e, messages, `执行结果 ${formatPageInfo(page, option.limit || DEFAULT_PAGE_SIZE, getTotal(results))}`, true)
    await e.reply(forward)
  }

  async repeat (e) {
    let debug = e.msg.includes('debug')
    let isRandom = e.msg.includes('随机')
    let qqStr = e.msg.replace(/^#(debug)?(随机)?学舌/, '').trim()
    let qq = qqStr || e.message.find(item => item.type === 'at')?.qq || e.sender.user_id

    if (isRandom) {
      let findUserRsp = await MeiliClient.getIndex().search('', {
        facets: ['sender.user_id'],
        filter: `group.group_id = ${e.group.group_id}`,
        limit: 1
      })
      let hits = findUserRsp.facetDistribution?.['sender.user_id'] || {}
      let aggr = []
      Object.keys(hits).forEach(q => {
        if (hits[q] > 20) {
          aggr.push({ qq: parseInt(q), count: hits[q] })
        }
      })
      if (aggr.length === 0) {
        e.reply('数据不足，无法随机学舌')
        return
      }
      let idx = Math.floor(Math.random() * aggr.length)
      qq = aggr[idx].qq
      let user = global.Bot?.gml?.get(e.group.group_id)?.get(qq)
      e.reply(`以下是模仿@${user?.card || user?.nickname || qq} (${qq})的说话风格。`)
    }

    const bymRes = await MeiliClient.getIndex().search('', {
      filter: `sender.user_id = ${qq} AND group.group_id = ${e.group.group_id}`,
      limit: 1000,
      sort: ['quotable.time:desc']
    })

    let validTexts = bymRes.hits.map(item => {
      let textElem = item.message?.find(i => i.text)
      if (textElem?.type === 'at') {
        textElem.text = '@' + textElem.text
      }
      return textElem?.text
    }).filter(t => t?.length > 5)

    validTexts = _.shuffle(validTexts)
    let bymTexts = validTexts.slice(0, 50).join('\n')

    let prompt = `以下是该群友近期在群内的发言，你要模仿他的说话风格说话。\n\n${bymTexts}\n\n以上就是他的说话记录了，现在给出一句适合发在群里且风格相似的话吧，直接回复内容，不要加任何其他格式或内容。要求给出三个候选项，用换行符隔开。`
    let systemPrompt = '你需要模仿指定群友的说话风格说话。不要重复他的话，尽可能符合情境地说一句或一段话即可。要求给出三个候选项，用换行符隔开。要求重点学习常用口癖词汇、标点符号、语气词等，以及关注的领域。不要OOC，不要自己编造破坏人设。'

    try {
      let resText = await callChat(prompt, systemPrompt, 'repeat')
      let candidates = resText.split('\n')
      for (let candidate of candidates) {
        if (!candidate.trim()) continue
        await e.reply(candidate.trim())
        await sleep(500)
      }
    } catch (error) {
      logger.error('学舌失败:', error)
      if (error.message?.includes('API Key 未配置')) {
        e.reply('⚠️ 请先在 config/config.yaml 或锅巴后台中配置对话大模型的 API Key')
      } else {
        e.reply('学舌失败，请检查 API 配置或日志。')
      }
    }

    if (debug) {
      let msgs = validTexts.slice(0, 30).map(t => segment.text(t))
      e.user_id = qq
      e.sender.card = '被模仿者'
      let f = await makeForwardMsg(e, msgs, '学舌依据', true)
      e.reply(f)
    }
  }

  async descriptionUser (e) {
    let isRandom = e.msg.includes('随机')
    let qqStr = e.msg.replace(/^#(debug)?(随机)?画像/, '').trim()
    try {
      if (qqStr) parseInt(qqStr)
    } catch {
      e.reply('只允许接 qq 号', true)
      return
    }

    let qq = qqStr || e.message.find(item => item.type === 'at')?.qq || e.sender.user_id
    if (isRandom) {
      let findUserRsp = await MeiliClient.getIndex().search('', {
        facets: ['sender.user_id'],
        filter: `group.group_id = ${e.group.group_id}`,
        limit: 1
      })
      let hits = findUserRsp.facetDistribution?.['sender.user_id'] || {}
      let aggr = []
      Object.keys(hits).forEach(q => {
        if (hits[q] > 20) {
          aggr.push({ qq: parseInt(q), count: hits[q] })
        }
      })
      if (aggr.length === 0) {
        e.reply('数据不足，无法随机画像')
        return
      }
      let idx = Math.floor(Math.random() * aggr.length)
      qq = aggr[idx].qq
      let user = global.Bot?.gml?.get(e.group.group_id)?.get(qq)
      e.reply(`以下是@${user?.card || user?.nickname || qq} (${qq}) 的用户画像。`)
    }

    const bymRes = await MeiliClient.getIndex().search('', {
      filter: `sender.user_id = ${qq} AND group.group_id = ${e.group.group_id}`,
      limit: 1000,
      sort: ['quotable.time:desc']
    })

    let validTexts = bymRes.hits.map(item => {
      let textElem = item.message?.find(i => i.text)
      if (textElem?.type === 'at') {
        textElem.text = '@' + textElem.text
      }
      let imageElem = item.message?.find(i => i.description)
      let image = imageElem ? `\n发送了${imageElem.asface ? '表情包' : '图片'}。${imageElem.asface ? '表情包' : '图片'}内容是${imageElem.description}` : ''
      let time = item.quotable.time
      let date = formatDate(new Date(time * 1000))
      if (textElem?.text || image) {
        return date + ': ' + (textElem?.text || '') + image
      }
      return ''
    }).filter(t => t.length > 5)

    let bymTexts = validTexts.slice(0, 80).join('\n')
    let prompt = `以下是该群友近期在群内的发言，你要对其进行总结，包括关键主题、说话风格、人物性格等，包含客观描述和主观推测，并在最后作诗一首总结这个人。\n\n${bymTexts}\n\n以上就是他的说话记录了，现在给出你对这个人的的人物画像吧，直接给出结果，不要附带任何其他文本。要求禁止使用markdown格式。`

    let card = global.Bot?.gml?.get(e.group.group_id)?.get(qq)?.card || global.Bot?.gml?.get(e.group.group_id)?.get(qq)?.nickname
    let systemPrompt = `以下是该群友近期在群内的发言，你要对其进行总结，包括关键主题、说话风格、人物性格等，包含客观描述和主观推测.禁止使用Markdown格式输出。不仅要注意发言内容，还应该注意时间。注意保护可能存在的个人信息等隐私。该用户的qq号是${qq}`
    if (card) {
      systemPrompt += `, 群名片是${card}`
    }

    try {
      let resText = await callChat(prompt, systemPrompt, 'desc')
      const long = segment.text(resText)
      const msgs = await e.group.makeForwardMsg([{
        user_id: 10000,
        message: long,
        nickname: '人物画像'
      }])
      e.reply(msgs)
    } catch (error) {
      logger.error('用户画像生成失败:', error)
      if (error.message?.includes('API Key 未配置')) {
        e.reply('⚠️ 请先在 config/config.yaml 或锅巴后台中配置对话大模型的 API Key')
      } else {
        e.reply('生成失败，请检查后台日志。')
      }
    }
  }

  async descriptionGroup (e) {
    let limit = e.msg.replace(/^#群画像/, '').trim() || '1000'
    try {
      limit = parseInt(limit)
    } catch {}
    if (limit > 10000) limit = 10000

    const bymRes = await MeiliClient.getIndex().search('', {
      filter: `group.group_id = ${e.group.group_id}`,
      limit,
      sort: ['quotable.time:desc']
    })

    let validTexts = bymRes.hits.map(item => {
      let textElem = item.message?.find(i => i.text)
      if (textElem?.type === 'at') {
        textElem.text = '@' + textElem.text
      }
      let imageElem = item.message?.find(i => i.description)
      let image = imageElem ? `\n发送了${imageElem.asface ? '表情包' : '图片'}。${imageElem.asface ? '表情包' : '图片'}内容是${imageElem.description}` : ''
      let time = item.quotable.time
      let date = formatDate(new Date(time * 1000))
      let qq = item.sender.user_id
      let card = item.sender.card || item.sender.nickname || qq
      if (textElem?.text || image) {
        return `${card} (${qq}) ` + date + ': ' + (textElem?.text || '') + image
      }
      return ''
    }).filter(t => t.length > 5)

    let bymTexts = validTexts.slice(0, 100).join('\n')
    let prompt = `以下是该群近期的发言，你要对其进行总结，包括关键主题、说话风格、人物性格等，包含客观描述和主观推测，并在最后作诗一首总结这个群。\n\n${bymTexts}\n\n以上就是本群的说话记录了，现在给出你对这个群的的画像吧，直接给出结果，不要附带任何其他文本。要求禁止使用markdown格式。`

    let card = e.group.name || e.group.group_name
    let systemPrompt = '以下是该群的网友近期在群内的发言，你要对其进行总结，包括关键主题、说话风格、人物性格等，包含客观描述和主观推测.禁止使用Markdown格式输出。不仅要注意发言内容，还应该注意时间。注意保护可能存在的个人信息等隐私。'
    if (card) {
      systemPrompt += `群名是${card}`
    }

    try {
      let resText = await callChat(prompt, systemPrompt, 'desc')
      const long = segment.text(resText)
      const msgs = await e.group.makeForwardMsg([{
        user_id: 10000,
        message: long,
        nickname: '群画像'
      }])
      e.reply(msgs)
    } catch (error) {
      logger.error('群画像生成失败:', error)
      if (error.message?.includes('API Key 未配置')) {
        e.reply('⚠️ 请先在 config/config.yaml 或锅巴后台中配置对话大模型的 API Key')
      } else {
        e.reply('生成失败，请检查后台日志。')
      }
    }
  }
}

// ================= 辅助函数 =================

function parsePageCommand (msg, defaultPage = 1) {
  let text = msg || ''
  let page = defaultPage
  const patterns = [
    /\s+第(\d+)页\s*$/,
    /\s+p(?:age)?\s*(\d+)\s*$/i,
    /\s+页\s*(\d+)\s*$/
  ]
  for (const pattern of patterns) {
    const matched = text.match(pattern)
    if (matched) {
      page = Math.max(1, parseInt(matched[1]))
      text = text.replace(pattern, '').trim()
      break
    }
  }
  return { text, page }
}

function parseLimit (msg, defaultLimit, maxLimit) {
  const matched = String(msg || '').match(/\s(\d{2,5})(?:条|个)?\s*$/)
  if (!matched) return defaultLimit
  return Math.min(maxLimit, Math.max(100, parseInt(matched[1])))
}

function getTodayStartSeconds () {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return Math.floor(date.getTime() / 1000)
}

function getTotal (results) {
  return results.totalHits || results.estimatedTotalHits || results.hits?.length || 0
}

function formatPageInfo (page, pageSize, total) {
  const totalPage = Math.max(1, Math.ceil((total || 0) / pageSize))
  return `第${page}/${totalPage}页，每页${pageSize}条，共${total || 0}条；下一页可在指令末尾加“第${page + 1}页”`
}

function escapeFilterString (value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function getTargetImage (e) {
  let image = e.message?.find(item => item.type === 'image')
  if (image) return image

  let reply
  try {
    if (e.getReply) {
      reply = (await e.getReply())?.message
    } else if (e.source) {
      const seq = e.isGroup ? e.source.seq : e.source.time
      reply = e.isGroup
        ? (await e.group.getChatHistory(seq, 1)).pop()?.message
        : (await e.friend.getChatHistory(seq, 1)).pop()?.message
    }
  } catch (err) {
    logger.warn?.(err)
  }
  return reply?.find(item => item.type === 'image')
}

function getMemberName (e, qq) {
  if (!qq) return '未知用户'
  try {
    const user = global.Bot?.gml?.get(e.group?.group_id)?.get(Number(qq)) || global.Bot?.gml?.get(e.group?.group_id)?.get(String(qq))
    return user?.card || user?.nickname || String(qq)
  } catch {
    return String(qq)
  }
}

function extractText (hit) {
  return (hit.message || []).map(item => {
    if (item.type === 'text') return item.text
    return ''
  }).join(' ')
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function formatDate (date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const h = String(date.getHours()).padStart(2, '0')
  const min = String(date.getMinutes()).padStart(2, '0')
  const s = String(date.getSeconds()).padStart(2, '0')
  return `${y}-${m}-${d} ${h}:${min}:${s}`
}

async function handleHits (results) {
  let messages = []
  const cfg = Config.getConfig().storage || {}
  const receivedDir = cfg.receivedDir || './data/chronicle/received'

  for (let msg of results.hits || []) {
    let elm = []
    for (let item of msg.message || []) {
      try {
        if (item.type === 'text') {
          elm.push(item.text)
        }
        if (item.type === 'image') {
          let file = item.file
          let absPath = path.resolve(process.cwd(), receivedDir, file)
          let buffer = fs.readFileSync(absPath)
          let imgElem = segment.image(buffer)
          elm.push(imgElem)
        }
        if (item.type === 'face') {
          elm.push(segment.face(item.id))
        }
        if (item.type === 'at') {
          elm.push(segment.at(item.qq))
        }
        if (item.type === 'json') {
          let json = JSON.parse(item.data)
          if (json?.meta?.detail?.resid) {
            let elem = segment.json(json)
            elm.push(elem)
          }
        }
        if (item.type === 'file') {
          let file = item.name
          if (file.endsWith('.mp4')) {
            let absPath = path.resolve(process.cwd(), receivedDir, file)
            let buffer = fs.readFileSync(absPath)
            let imgElem = segment.video(buffer)
            elm.push(imgElem)
          } else {
            elm.push(segment.text(`[文件]${file}`))
          }
        }
      } catch (err) {
        logger.warn?.(err)
      }
    }
    if (elm.length > 0) {
      messages.push({
        msg: elm,
        time: msg.quotable?.time,
        userInfo: {
          user_id: msg.sender?.user_id,
          nickname: msg.sender?.card || msg.sender?.nickname
        }
      })
    }
  }
  return messages
}

async function makeForwardMsg (e, msg = [], dec = '', msgsscr = false) {
  if (!Array.isArray(msg)) {
    msg = [msg]
  }

  let name = msgsscr ? e.sender?.card || e.user_id : global.Bot?.nickname
  let id = msgsscr ? e.user_id : global.Bot?.uin

  if (e.isGroup) {
    try {
      let info = await e.bot.getGroupMemberInfo(e.group_id, id)
      name = info.card || info.nickname
    } catch {}
  }

  let userInfo = {
    user_id: id,
    nickname: name
  }

  let forwardMsg = []
  for (const message of msg) {
    if (!message) continue

    if (message.userInfo) {
      userInfo = message.userInfo
      delete message.userInfo
    }
    let toPush = {
      message: message.msg,
      time: message.time,
      ...userInfo
    }
    forwardMsg.push(toPush)
  }

  try {
    if (e?.group?.makeForwardMsg) {
      forwardMsg = await e.group.makeForwardMsg(forwardMsg)
    } else if (e?.friend?.makeForwardMsg) {
      forwardMsg = await e.friend.makeForwardMsg(forwardMsg)
    } else {
      return msg.join('\n')
    }

    if (dec) {
      if (typeof forwardMsg.data === 'object') {
        let detail = forwardMsg.data?.meta?.detail
        if (detail) {
          detail.news = [{ text: dec }]
        }
      } else {
        forwardMsg.data = forwardMsg.data
          .replace(/\n/g, '')
          .replace(/<title color="#777777" size="26">(.+?)<\/title>/g, '___')
          .replace(/___+/, `<title color="#777777" size="26">${dec}</title>`)
      }
    }
  } catch {}

  return forwardMsg
}
