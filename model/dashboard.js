import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { URL } from 'node:url'
import Config from './config.js'
import MeiliClient from './meiliClient.js'

import { fileURLToPath } from 'node:url'

const PLUGIN_NAME = 'chronicle-plugin'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_PATH = path.resolve(__dirname, '..')

class DashboardServer {
  constructor () {
    this.server = null
    this.isRunning = false
  }

  /**
   * 获取认证 Token / Key
   */
  getAuthToken () {
    const cfg = Config.getConfig()
    return cfg.dashboard?.authKey || cfg.meilisearch?.apiKey || ''
  }

  /**
   * 鉴权检查
   */
  checkAuth (req, parsedUrl) {
    const token = this.getAuthToken()
    if (!token) return true // 若未设置任何 key，允许访问

    const authHeader = req.headers.authorization || ''
    if (authHeader.startsWith('Bearer ')) {
      if (authHeader.slice(7).trim() === token) return true
    }

    const queryToken = parsedUrl.searchParams.get('token')
    if (queryToken && queryToken === token) return true

    const cookieHeader = req.headers.cookie || ''
    const match = cookieHeader.match(/meili_token=([^;]+)/)
    if (match && decodeURIComponent(match[1]) === token) return true

    return false
  }

  /**
   * 启动后台管理面板 HTTP 服务
   */
  async start () {
    const cfg = Config.getConfig().dashboard || {}
    if (cfg.enable === false) {
      return
    }

    if (this.isRunning) return

    const host = cfg.host || '0.0.0.0'
    const port = cfg.port || 7701
    const log = global.logger || console

    this.server = http.createServer(async (req, res) => {
      try {
        await this.handleRequest(req, res)
      } catch (err) {
        log.error?.(`[${PLUGIN_NAME}] 面板请求处理异常:`, err)
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ error: err.message || 'Internal Server Error' }))
        }
      }
    })

    this.server.on('error', err => {
      if (err.code === 'EADDRINUSE') {
        log.warn?.(`[${PLUGIN_NAME}] 管理面板端口 ${port} 已被占用，跳过启动面板`)
      } else {
        log.error?.(`[${PLUGIN_NAME}] 管理面板启动错误:`, err)
      }
    })

    return new Promise(resolve => {
      this.server.listen(port, host, () => {
        this.isRunning = true
        const token = this.getAuthToken()
        const tokenQuery = token ? `?token=${token}` : ''
        log.info?.(`[${PLUGIN_NAME}] 🖥️ 内置管理面板已启动: http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/${tokenQuery}`)
        resolve(true)
      })
    })
  }

  /**
   * 请求分发路由
   */
  async handleRequest (req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const pathname = parsedUrl.pathname

    // 静态前端页面无需拦截认证（由前端自动附带 Token 或弹出登录框）
    if (pathname === '/' || pathname === '/index.html') {
      const htmlPath = path.join(PLUGIN_PATH, 'resources', 'dashboard', 'index.html')
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        fs.createReadStream(htmlPath).pipe(res)
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Dashboard HTML template not found')
      }
      return
    }

    // 多媒体文件安全读取代理（受 token 保护）
    if (pathname.startsWith('/api/media/')) {
      if (!this.checkAuth(req, parsedUrl)) {
        res.writeHead(401, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Unauthorized' }))
        return
      }

      const filename = path.basename(pathname.replace('/api/media/', ''))
      const storageCfg = Config.getConfig().storage || {}
      const receivedDir = storageCfg.receivedDir || './data/chronicle/received'
      const filePath = path.resolve(process.cwd(), receivedDir, filename)

      if (fs.existsSync(filePath)) {
        const ext = path.extname(filename).toLowerCase()
        const mimeMap = {
          '.jpg': 'image/jpeg',
          '.jpeg': 'image/jpeg',
          '.png': 'image/png',
          '.gif': 'image/gif',
          '.webp': 'image/webp',
          '.mp4': 'video/mp4'
        }
        res.writeHead(200, {
          'Content-Type': mimeMap[ext] || 'application/octet-stream',
          'Cache-Control': 'public, max-age=86400'
        })
        fs.createReadStream(filePath).pipe(res)
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('File not found')
      }
      return
    }

    // API 鉴权验证
    if (pathname.startsWith('/api/')) {
      if (!this.checkAuth(req, parsedUrl)) {
        res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'Unauthorized', message: 'Token 认证失败，请提供合法的 Bearer Token' }))
        return
      }

      // API 1: 获取服务状态与基本统计
      if (pathname === '/api/status' && req.method === 'GET') {
        const client = MeiliClient.getClient()
        const index = MeiliClient.getIndex()
        const cfg = Config.getConfig()

        let health = null
        let version = null
        let stats = null

        try {
          health = await client.health()
        } catch (e) { health = { status: 'error', error: e.message } }

        try {
          version = await client.getVersion()
        } catch {}

        try {
          stats = await index.getStats()
        } catch {}

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({
          health,
          version,
          stats,
          config: {
            host: cfg.meilisearch?.host,
            port: cfg.meilisearch?.port,
            embedded: cfg.meilisearch?.embedded,
            indexName: MeiliClient.getIndexName(),
            receivedDir: cfg.storage?.receivedDir || './data/chronicle/received'
          }
        }))
        return
      }

      // API 2: 全文检索与过滤查询
      if (pathname === '/api/search' && req.method === 'POST') {
        const body = await this.readJsonBody(req)
        const q = String(body.q || '')
        const limit = Math.min(100, Math.max(1, parseInt(body.limit) || 20))
        const offset = Math.max(0, parseInt(body.offset) || 0)
        const filter = body.filter || undefined
        const sort = body.sort ? (Array.isArray(body.sort) ? body.sort : [body.sort]) : ['quotable.time:desc']

        const index = MeiliClient.getIndex()
        const searchOptions = {
          filter,
          limit,
          offset,
          sort
        }
        if (q) {
          searchOptions.attributesToSearchOn = ['message.text', 'json.data', 'message.summary', 'message.description', 'message.tags', 'message.file', 'message.md5']
        }
        const searchRes = await index.search(q, searchOptions)

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(searchRes))
        return
      }

      // API 3: 获取聚合数据 (热门 Tags、活跃群聊、活跃发言人)
      if (pathname === '/api/facets' && req.method === 'GET') {
        try {
          const [tagsAggr, senderAggr, groupAggr] = await Promise.all([
            MeiliClient.facetAggr('message.tags', '', 30).catch(() => ({ facetHits: [] })),
            MeiliClient.facetAggr('sender.user_id', '', 20).catch(() => ({ facetHits: [] })),
            MeiliClient.facetAggr('group.group_id', '', 20).catch(() => ({ facetHits: [] }))
          ])

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({
            tags: tagsAggr.facetHits || [],
            senders: senderAggr.facetHits || [],
            groups: groupAggr.facetHits || []
          }))
        } catch (e) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ tags: [], senders: [], groups: [], error: e.message }))
        }
        return
      }

      // API 4: 单条文档详情
      if (pathname.startsWith('/api/document/') && req.method === 'GET') {
        const id = pathname.replace('/api/document/', '').trim()
        const doc = await MeiliClient.getIndex().getDocument(id)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(doc))
        return
      }

      // API 5: 删除单条文档
      if (pathname.startsWith('/api/document/') && req.method === 'DELETE') {
        const id = pathname.replace('/api/document/', '').trim()
        const task = await MeiliClient.getIndex().deleteDocument(id)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: true, task }))
        return
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Not Found' }))
  }

  /**
   * 读取 JSON 请求体
   */
  readJsonBody (req) {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', chunk => { data += chunk })
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {})
        } catch (err) {
          reject(err)
        }
      })
      req.on('error', reject)
    })
  }

  /**
   * 关闭面板服务
   */
  stop () {
    if (this.server) {
      try {
        this.server.close()
      } catch {}
      this.server = null
      this.isRunning = false
    }
  }
}

export default new DashboardServer()
