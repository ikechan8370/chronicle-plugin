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
 * 下载远程文件到本地
 * @param {string} url 下载链接
 * @param {string} destPath 目标文件路径
 * @param {boolean} absolute 是否为绝对路径，默认为 false（此时存放在 config.storage.receivedDir）
 * @param {boolean} ignoreCertificateError 是否忽略证书错误
 * @param {object} headers 自定义请求头
 * @returns {Promise<string>} 返回最终保存的绝对路径
 */
export async function downloadFile (url, destPath, absolute = false, ignoreCertificateError = true, headers, timeout = 10000) {
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

  try {
    const response = await fetch(url, init)
    if (!response.ok) {
      throw new Error(`下载文件失败，HTTP 状态码: ${response.status} URL: ${url}`)
    }

    let dest = destPath
    if (!absolute) {
      const cfg = Config.getConfig().storage || {}
      const receivedDir = cfg.receivedDir || './data/chatgpt/data/received'
      dest = path.resolve(process.cwd(), receivedDir, destPath)
    }

    const dir = path.dirname(dest)
    mkdirs(dir)

    const fileStream = fs.createWriteStream(dest)
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

    return dest
  } finally {
    clearTimeout(timer)
  }
}
