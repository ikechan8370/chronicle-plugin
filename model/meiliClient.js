import { MeiliSearch } from 'meilisearch'
import fetch from 'node-fetch'
import Config from './config.js'

class MeiliClientManager {
  constructor () {
    this.client = null
  }

  /**
   * 获取 Meilisearch 客户端实例
   */
  getClient () {
    const cfg = Config.getConfig().meilisearch || {}
    const hostUrl = `http://${cfg.host}:${cfg.port}`

    if (!this.client) {
      this.client = new MeiliSearch({
        host: hostUrl,
        apiKey: cfg.apiKey
      })
    }
    return this.client
  }

  /**
   * 获取指定索引名称
   */
  getIndexName () {
    const cfg = Config.getConfig().meilisearch || {}
    return cfg.indexName || 'messages'
  }

  /**
   * 获取索引对象
   */
  getIndex () {
    return this.getClient().index(this.getIndexName())
  }

  /**
   * 初始化索引及相关检索属性
   */
  async initIndex () {
    const client = this.getClient()
    const indexName = this.getIndexName()
    const log = global.logger || console

    try {
      // 检查索引是否存在，不存在则创建
      try {
        await client.getIndex(indexName)
      } catch (e) {
        log.info(`[chronicle-plugin] 索引 ${indexName} 不存在，正在创建...`)
        await client.createIndex(indexName, { primaryKey: 'id' })
      }

      const index = client.index(indexName)

      // 更新可过滤属性
      await index.updateFilterableAttributes([
        'message.type',
        'message.asface',
        'message.file',
        'message.md5',
        'message.qq',
        'message.tags',
        'group.group_id',
        'sender.user_id',
        'quotable.time'
      ])

      // 更新可排序属性
      await index.updateSortableAttributes([
        'quotable.time'
      ])

      // 更新可搜索属性
      await index.updateSearchableAttributes([
        'message.text',
        'json.data',
        'message.summary',
        'message.description',
        'message.tags'
      ])

      // 更新分页上限
      await index.updatePagination({
        maxTotalHits: 500000
      })

      log.info(`[chronicle-plugin] 索引 ${indexName} 配置初始化完成`)
      return true
    } catch (err) {
      log.error(`[chronicle-plugin] 初始化索引配置失败:`, err)
      return false
    }
  }

  /**
   * 使用 search API 进行 Facet 聚合统计
   */
  async facetAggr (facetName, filter = '', limit = 0) {
    const index = this.getIndex()
    const res = await index.search('', {
      facets: [facetName],
      filter: filter || undefined,
      limit: 0
    })
    const dist = res.facetDistribution?.[facetName] || {}
    const facetHits = Object.entries(dist)
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
    return { facetHits }
  }

  /**
   * 分批拉取用于词云的文本消息文档
   */
  async fetchWordCloudDocuments (filter, limit) {
    const cfg = Config.getConfig().meilisearch || {}
    const batchSize = 1000
    const hits = []
    const hasLimit = Number.isFinite(limit)

    for (let offset = 0; !hasLimit || offset < limit; offset += batchSize) {
      const batchLimit = hasLimit ? Math.min(batchSize, limit - offset) : batchSize
      const params = new URLSearchParams()
      params.set('limit', String(batchLimit))
      params.set('offset', String(offset))
      params.set('filter', filter)
      params.set('fields', 'message,sender.user_id,quotable.time')

      const url = `http://${cfg.host}:${cfg.port}/indexes/${this.getIndexName()}/documents?${params.toString()}`
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`
        }
      })
      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Meilisearch documents API Error: ${response.status} - ${errText}`)
      }
      const rsp = await response.json()
      const docs = rsp.results || []
      hits.push(...docs)
      if (docs.length < batchLimit) break
      if (typeof rsp.total === 'number' && offset + docs.length >= rsp.total) break
    }
    return hits
  }

  /**
   * 获取群成员显示名（优先本地群名片，其次 Meilisearch 发送历史）
   */
  async getDisplayName (e, qq, all = false) {
    let localName = String(qq)
    try {
      const user = global.Bot?.gml?.get(e.group?.group_id)?.get(Number(qq)) ||
                   global.Bot?.gml?.get(e.group?.group_id)?.get(String(qq))
      if (user?.card || user?.nickname) {
        return user.card || user.nickname
      }
    } catch {}

    try {
      let filter = `sender.user_id = ${qq}`
      if (!all && e.group?.group_id) {
        filter += ` AND group.group_id = ${e.group.group_id}`
      }
      const res = await this.getIndex().search('', {
        filter,
        limit: 1,
        sort: ['quotable.time:desc'],
        attributesToRetrieve: ['sender.card', 'sender.nickname']
      })
      const sender = res.hits?.[0]?.sender
      return sender?.card || sender?.nickname || String(qq)
    } catch {
      return String(qq)
    }
  }

  /**
   * Facet 聚合排行格式化
   */
  async facetRank (res, facetName, e, page, pageSize, all = false) {
    const list = Object.entries(res.facetDistribution?.[facetName] || {})
      .map(([qq, count]) => ({ qq, count }))
      .sort((a, b) => b.count - a.count)
    const start = (page - 1) * pageSize
    const lines = await Promise.all(list.slice(start, start + pageSize).map(async (item, idx) => {
      const no = start + idx + 1
      const name = await this.getDisplayName(e, item.qq, all)
      return `${no}. ${name} (${item.qq})：${item.count}次`
    }))
    return { total: list.length, lines }
  }
}

export default new MeiliClientManager()
