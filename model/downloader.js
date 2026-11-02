import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import fetch from 'node-fetch'
import Config from './config.js'

export function mkdirs (dirname) {
  if (!dirname) return true
  if (fs.existsSync(dirname)) {
    return true
  } else {
    if (mkdirs(path.dirname(dirname))) {
      fs.mkdirSync(dirname, { recursive: true })
      return true
    }
  }
}

/**
 * 下载远程文件到本地（支持原子写入、损坏文件清理与自动重试）
 * @param {string} url 下载链接
 * @param {string} destPath 目标文件路径
 * @param {boolean} absolute 是否为绝对路径，默认为 false（此时存放在 config.storage.receivedDir）
 * @param {boolean} ignoreCertificateError 是否忽略证书错误
 * @param {object} headers 自定义请求头
 * @param {number} timeout 单次请求超时（毫秒）
 * @param {number} retries 最大重试次数
 * @returns {Promise<string>} 返回最终保存的绝对路径
 */
export async function downloadFile (url, destPath, absolute = false, ignoreCertificateError = true, headers = null, timeout = 12000, retries = 2) {
  let dest = destPath
  if (!absolute) {
    const cfg = Config.getConfig().storage || {}
    const receivedDir = cfg.receivedDir || './data/chronicle/received'
    dest = path.resolve(process.cwd(), receivedDir, destPath)
  }

  const dir = path.dirname(dest)
  mkdirs(dir)

  let lastError = null

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    const init = { signal: controller.signal }
    if (headers) {
      init.headers = headers
    }
    if (ignoreCertificateError && url.startsWith('https')) {
      init.agent = new https.Agent({
        rejectUnauthorized: !ignoreCertificateError
      })
    }

    const tmpDest = `${dest}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

    try {
      const response = await fetch(url, init)
      if (!response.ok) {
        throw new Error(`HTTP 状态码: ${response.status} URL: ${url}`)
      }

      const fileStream = fs.createWriteStream(tmpDest)
      await new Promise((resolve, reject) => {
        response.body.pipe(fileStream)
        response.body.on('error', err => {
          fileStream.close()
          reject(err)
        })
        fileStream.on('error', err => {
          reject(err)
        })
        fileStream.on('finish', () => {
          resolve()
        })
      })

      // 校验下载的文件大小必须大于 0 字节
      if (!fs.existsSync(tmpDest)) {
        throw new Error('下载完成后临时文件未生成')
      }
      const stat = fs.statSync(tmpDest)
      if (stat.size === 0) {
        throw new Error('下载到的文件大小为 0 字节')
      }

      // 原子重命名为目标文件，防止读取到写入中的半截文件
      fs.renameSync(tmpDest, dest)
      return dest
    } catch (err) {
      lastError = err
      // 清理残留的临时文件
      try {
        if (fs.existsSync(tmpDest)) {
          fs.unlinkSync(tmpDest)
        }
      } catch {}

      if (attempt < retries) {
        // 短暂退避后重试
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      }
    } finally {
      clearTimeout(timer)
    }
  }

  throw new Error(`下载文件失败(重试${retries}次): ${lastError?.message || lastError}`)
}
