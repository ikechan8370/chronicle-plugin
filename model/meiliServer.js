import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import fetch from 'node-fetch'
import Config from './config.js'

import { fileURLToPath } from 'node:url'

const PLUGIN_NAME = 'chronicle-plugin'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_PATH = path.resolve(__dirname, '..')
const MEILI_VERSION = 'v1.12.0'

class MeiliServer {
  constructor () {
    this.child = null
    this.isRunning = false
    this.exitHandlerRegistered = false
  }

  /**
   * 获取当前系统与架构对应的 Meilisearch 文件名和 Release 资产名
   */
  getPlatformInfo () {
    const platform = process.platform
    const arch = process.arch

    let assetName = ''
    let exeName = 'meilisearch'

    if (platform === 'win32') {
      exeName = 'meilisearch.exe'
      if (arch === 'x64') {
        assetName = 'meilisearch-windows-amd64.exe'
      } else {
        throw new Error(`暂不支持的 Windows 架构: ${arch}`)
      }
    } else if (platform === 'linux') {
      if (arch === 'x64') {
        assetName = 'meilisearch-linux-amd64'
      } else if (arch === 'arm64') {
        assetName = 'meilisearch-linux-aarch64'
      } else {
        throw new Error(`暂不支持的 Linux 架构: ${arch}`)
      }
    } else if (platform === 'darwin') {
      if (arch === 'x64') {
        assetName = 'meilisearch-macos-amd64'
      } else if (arch === 'arm64') {
        assetName = 'meilisearch-macos-apple-silicon'
      } else {
        throw new Error(`暂不支持的 macOS 架构: ${arch}`)
      }
    } else {
      throw new Error(`暂不支持的操作系统: ${platform}`)
    }

    return { platform, arch, assetName, exeName }
  }

  /**
   * 获取二进制文件的绝对路径
   */
  getBinPath () {
    const cfg = Config.getConfig().meilisearch || {}
    if (cfg.binPath && fs.existsSync(cfg.binPath)) {
      return cfg.binPath
    }
    const { exeName } = this.getPlatformInfo()
    return path.join(PLUGIN_PATH, 'bin', exeName)
  }

  /**
   * 检查或自动下载 Meilisearch 二进制
   */
  async ensureBinary () {
    const binPath = this.getBinPath()
    if (fs.existsSync(binPath)) {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(binPath, 0o755)
        } catch {}
      }
      return binPath
    }

    const cfg = Config.getConfig().meilisearch || {}
    if (!cfg.autoDownload) {
      throw new Error(`Meilisearch 二进制文件不存在: ${binPath}，请手动放置或开启 autoDownload`)
    }

    const { assetName } = this.getPlatformInfo()
    const officialUrl = `https://github.com/meilisearch/meilisearch/releases/download/${MEILI_VERSION}/${assetName}`
    const candidateUrls = []

    if (cfg.downloadProxy) {
      candidateUrls.push(`${cfg.downloadProxy.replace(/\/+$/, '')}/${officialUrl}`)
    }
    candidateUrls.push(officialUrl)
    candidateUrls.push(`https://ghproxy.net/${officialUrl}`)
    candidateUrls.push(`https://ghfast.top/${officialUrl}`)

    const urls = [...new Set(candidateUrls)]
    const log = global.logger || console
    log.info(`[${PLUGIN_NAME}] 未检测到 Meilisearch 二进制，开始自动下载 ${MEILI_VERSION} (${assetName})...`)

    fs.mkdirSync(path.dirname(binPath), { recursive: true })
    const tempPath = `${binPath}.tmp`

    let downloadSuccess = false
    let lastError = null

    for (const downloadUrl of urls) {
      try {
        log.info(`[${PLUGIN_NAME}] 正在尝试从下载源拉取: ${downloadUrl}`)
        const res = await fetch(downloadUrl, { timeout: 30000 })
        if (!res.ok) {
          log.warn?.(`[${PLUGIN_NAME}] 下载源响应 HTTP ${res.status}，切换下一个源...`)
          continue
        }

        const fileStream = fs.createWriteStream(tempPath)
        await new Promise((resolve, reject) => {
          res.body.pipe(fileStream)
          res.body.on('error', reject)
          fileStream.on('finish', resolve)
        })

        downloadSuccess = true
        break
      } catch (err) {
        lastError = err
        log.warn?.(`[${PLUGIN_NAME}] 从 ${downloadUrl} 下载失败: ${err.message}，尝试下一个下载源...`)
      }
    }

    if (!downloadSuccess) {
      throw new Error(`所有下载源均失败: ${lastError?.message || '未知错误'}`)
    }

    if (process.platform !== 'win32') {
      fs.chmodSync(tempPath, 0o755)
    }

    fs.renameSync(tempPath, binPath)
    log.info(`[${PLUGIN_NAME}] Meilisearch 二进制文件下载完成并就绪: ${binPath}`)
    return binPath
  }

  /**
   * 启动内置 Meilisearch 服务
   */
  async start () {
    const cfg = Config.getConfig().meilisearch || {}
    const log = global.logger || console

    if (!cfg.embedded) {
      log.info(`[${PLUGIN_NAME}] 配置为使用外部 Meilisearch 服务: http://${cfg.host}:${cfg.port}`)
      return this.waitForReady(5000)
    }

    // 检查服务是否已经在运行（例如端口已被现有 Meilisearch 占用）
    const isAlreadyRunning = await this.checkHealth(cfg.host, cfg.port)
    if (isAlreadyRunning) {
      log.info(`[${PLUGIN_NAME}] 检测到 http://${cfg.host}:${cfg.port} 已有 Meilisearch 服务在运行，直接复用`)
      this.isRunning = true
      return true
    }

    // 若未配置 API Key 或长度不足 16 字节，自动生成随机安全密钥并保存
    if (!cfg.apiKey || String(cfg.apiKey).length < 16) {
      const { randomBytes } = await import('node:crypto')
      const generatedKey = randomBytes(24).toString('hex')
      cfg.apiKey = generatedKey
      Config.saveConfig({ meilisearch: { apiKey: generatedKey } })
      log.info(`[${PLUGIN_NAME}] 已自动为您生成 Meilisearch Master Key: ${generatedKey}`)
    }

    const binPath = await this.ensureBinary()
    const dbPath = path.resolve(process.cwd(), cfg.dbPath || './data/meilisearch/data.ms')
    fs.mkdirSync(path.dirname(dbPath), { recursive: true })

    const args = [
      '--db-path', dbPath,
      '--http-addr', `${cfg.host}:${cfg.port}`,
      '--master-key', cfg.apiKey,
      '--no-analytics'
    ]

    log.info(`[${PLUGIN_NAME}] 正在启动内置 Meilisearch 服务...`)
    this.child = spawn(binPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    this.child.stdout.on('data', data => {
      const line = data.toString().trim()
      if (line) {
        log.debug?.(`[Meilisearch] ${line}`)
      }
    })

    this.child.stderr.on('data', data => {
      const line = data.toString().trim()
      if (line) {
        if (/\b(PANIC|FATAL)\b/i.test(line)) {
          log.error?.(`[Meilisearch] ${line}`)
        } else {
          log.debug?.(`[Meilisearch] ${line}`)
        }
      }
    })

    this.child.on('error', err => {
      log.error(`[${PLUGIN_NAME}] Meilisearch 进程异常:`, err)
    })

    this.child.on('exit', (code, signal) => {
      this.isRunning = false
      if (code !== 0 && signal !== 'SIGTERM') {
        log.warn(`[${PLUGIN_NAME}] Meilisearch 进程退出，退出码: ${code}, 信号: ${signal}`)
      }
    })

    this.registerExitHandler()
    await this.waitForReady(30000)
    this.isRunning = true
    log.info(`[${PLUGIN_NAME}] 内置 Meilisearch 服务启动成功 (http://${cfg.host}:${cfg.port})`)
    return true
  }

  /**
   * 检查服务健康状态
   */
  async checkHealth (host, port) {
    try {
      const res = await fetch(`http://${host}:${port}/health`, { timeout: 1500 })
      if (res.ok) {
        const json = await res.json()
        return json.status === 'available'
      }
    } catch {}
    return false
  }

  /**
   * 等待服务就绪
   */
  async waitForReady (timeoutMs = 30000) {
    const cfg = Config.getConfig().meilisearch || {}
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (await this.checkHealth(cfg.host, cfg.port)) {
        return true
      }
      await new Promise(r => setTimeout(r, 500))
    }
    throw new Error(`Meilisearch 服务在 ${timeoutMs}ms 内未能就绪`)
  }

  /**
   * 停止内置服务
   */
  stop () {
    if (this.child) {
      try {
        this.child.kill('SIGTERM')
      } catch {}
      this.child = null
      this.isRunning = false
    }
  }

  /**
   * 注册父进程退出事件以优雅关闭子进程
   */
  registerExitHandler () {
    if (this.exitHandlerRegistered) return
    this.exitHandlerRegistered = true

    const cleanup = () => {
      this.stop()
    }

    process.on('exit', cleanup)
    process.on('SIGINT', () => {
      cleanup()
      process.exit()
    })
    process.on('SIGTERM', () => {
      cleanup()
      process.exit()
    })
  }
}

export default new MeiliServer()
