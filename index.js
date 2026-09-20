import fs from 'node:fs'
import path from 'node:path'
import MeiliServer from './model/meiliServer.js'
import MeiliClient from './model/meiliClient.js'
import DashboardServer from './model/dashboard.js'

const PLUGIN_NAME = 'chronicle-plugin'
const log = global.logger || console

if (!global.segment) {
  try {
    global.segment = (await import('oicq')).segment
  } catch {}
}

const yellow = global.logger?.yellow || (s => s)
const green = global.logger?.green || (s => s)

log.info?.(yellow(`- 正在载入 [${PLUGIN_NAME}] 插件...`))

// 异步启动 Meilisearch 服务、初始化索引与管理面板
;(async () => {
  try {
    await MeiliServer.start()
    await MeiliClient.initIndex()
    await DashboardServer.start()
  } catch (err) {
    log.error?.(`[${PLUGIN_NAME}] 初始化服务失败:`, err)
  }
})()

const appsDir = path.resolve(process.cwd(), 'plugins', PLUGIN_NAME, 'apps')
let apps = {}

if (fs.existsSync(appsDir)) {
  const files = fs.readdirSync(appsDir).filter(file => file.endsWith('.js'))
  const ret = await Promise.allSettled(files.map(file => import(`./apps/${file}`)))

  for (let i = 0; i < files.length; i++) {
    const name = files[i].replace('.js', '')
    if (ret[i].status !== 'fulfilled') {
      log.error?.(`[${PLUGIN_NAME}] 载入子应用错误: ${name}`)
      log.error?.(ret[i].reason)
      continue
    }
    apps[name] = ret[i].value[Object.keys(ret[i].value)[0]]
  }
} else {
  // 本地开发或测试环境直接引入
  const { Indexer } = await import('./apps/indexer.js')
  const { Search } = await import('./apps/search.js')
  apps = { Indexer, Search }
}

log.info?.(green(`- [${PLUGIN_NAME}] 载入成功`))

export { apps }
