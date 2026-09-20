import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileTypeFromBuffer } from 'file-type'
import plugin from '../../../lib/plugins/plugin.js'
import Config from '../model/config.js'
import MeiliClient from '../model/meiliClient.js'
import { downloadFile, mkdirs } from '../model/downloader.js'
import { describeImageWithRetry } from '../model/ai.js'

let isListenerBound = false

/**
 * 获取 at 目标的用户昵称/名片（跨适配器兼容）
 */
function getAtTargetName (e, item) {
  if (item.text && item.text !== item.qq && !/^\d+$/.test(item.text)) {
    return item.text
  }
  if (item.qq === 'all') {
    return '全体成员'
  }
  const qq = item.qq
  try {
    // 兼容 ICQQ / TRSS-Yunzai / OneBot / Lagrange
    const member = e.group?.pickMember?.(qq) ||
                   e.group?.pickMember?.(Number(qq)) ||
                   e.bot?.gml?.get(e.group_id)?.get(qq) ||
                   e.bot?.gml?.get(e.group_id)?.get(Number(qq)) ||
                   e.bot?.fl?.get(qq) ||
                   e.bot?.fl?.get(Number(qq))

    const name = member?.card || member?.nickname || member?.name
    if (name) return name
  } catch {}

  return item.text || String(qq)
}

/**
 * 统一处理接收到的消息并写入 Meilisearch 索引
 */
async function handleMessage (e) {
  try {
    if (!e || !e.message || !Array.isArray(e.message)) return

    const log = global.logger || console
    const cfg = Config.getConfig()
    const receivedDir = cfg.storage?.receivedDir || './data/chronicle/received'
    const fullReceivedDir = path.resolve(process.cwd(), receivedDir)
    mkdirs(fullReceivedDir)

    // 跨适配器归一化 Sender 与 Group 标识
    const userId = String(e.user_id || e.sender?.user_id || '')
    const senderCard = e.sender?.card || e.member?.card || ''
    const senderNick = e.sender?.nickname || e.member?.nickname || e.member?.name || userId
    const isGroup = Boolean(e.isGroup || e.group_id)
    const groupId = isGroup ? String(e.group_id || e.group?.group_id || '0') : '0'
    const groupName = e.group_name || e.group?.name || e.group?.group_name || e.bot?.gl?.get(e.group_id)?.group_name || (isGroup ? groupId : '')

    // 格式化消息分段（解析 at 昵称，标准化多媒体引用）
    const formattedMessage = []
    for (const rawItem of e.message) {
      if (!rawItem || typeof rawItem !== 'object') continue
      const item = { ...rawItem }

      if (item.type === 'at') {
        const atText = getAtTargetName(e, item)
        item.text = atText
      } else if (item.type === 'bface') {
        item.summary = item.text ? `[商城表情: ${item.text}]` : '[商城表情]'
        item.description = item.text ? `商城表情: ${item.text}` : '商城表情'
        item.tags = item.text ? [item.text, '商城表情', '表情包'] : ['商城表情', '表情包']
        item.asface = true
      }
      formattedMessage.push(item)
    }

    const timestamp = e.time || Math.floor(Date.now() / 1000)
    const msgSeq = e.seq || e.message_id || Math.random().toString(36).slice(2, 8)

    const messageData = {
      id: `${timestamp}_${userId}_${msgSeq}`,
      message: formattedMessage,
      sender: {
        user_id: userId,
        card: senderCard,
        nickname: senderNick
      },
      group: {
        isGroup,
        group_id: groupId,
        group_name: groupName
      },
      quotable: {
        user_id: userId,
        time: timestamp,
        seq: msgSeq,
        rand: e.rand || 0
      },
      adapter: e.adapter_name || e.bot?.adapter?.name || (global.Bot?.uin ? 'TRSS' : 'icqq')
    }

    // ⚡ 1. 立即毫秒级写入 Meilisearch 索引！绝对不阻塞主消息事件循环！
    await MeiliClient.getIndex().addDocuments([messageData])
    log.info(`[chronicle-plugin] 💾 消息已即时入库: ${messageData.id} [${groupName || '私聊'}] ${senderNick}`)

    // 🚀 2. 异步处理多媒体资源（下载图片、群文件、调用视觉大模型打标）
    // 后台独立执行，绝不阻塞任何后续群聊消息！
    processMediaAsync(e, messageData, formattedMessage, fullReceivedDir, groupName, senderNick, userId).catch(err => {
      log.error(`[chronicle-plugin] 后台处理媒体资源异常:`, err)
    })
  } catch (err) {
    const log = global.logger || console
    log.error(`[chronicle-plugin] 消息索引入库异常:`, err)
  }
}

/**
 * 后台异步处理媒体资源与视觉大模型打标，完成后回写更新 Meilisearch 索引
 */
async function processMediaAsync (e, messageData, formattedMessage, fullReceivedDir, groupName, senderNick, userId) {
  const log = global.logger || console
  let hasImageUpdates = false

  const storageCfg = Config.getConfig().storage || {}
  const saveImage = storageCfg.saveImage ?? true
  const saveVideo = storageCfg.saveVideo ?? false
  const saveFile = storageCfg.saveFile ?? false
  const maxFileSizeMB = storageCfg.maxFileSizeMB || 50
  const maxFileSizeBytes = maxFileSizeMB * 1024 * 1024

  for (const item of formattedMessage) {
    if (item.type === 'image') {
      if (!saveImage) {
        log.debug?.(`[chronicle-plugin] 配置为不保存群聊图片，跳过本地存储: ${item.file || item.url || ''}`)
        continue
      }
      try {
        let imageUrl = item.url || ''
        if (!imageUrl && Array.isArray(e.img) && e.img.length > 0) {
          imageUrl = e.img[0]
        }
        let isBase64 = false
        let base64Content = ''
        let isLocal = false
        let localPath = ''

        // 多适配器来源兼容：OneBot / Satori / Lagrange / ICQQ
        if (typeof item.file === 'string') {
          if (/^https?:\/\//i.test(item.file)) {
            imageUrl = item.file
          } else if (item.file.startsWith('base64://')) {
            isBase64 = true
            base64Content = item.file.replace(/^base64:\/\//, '')
          } else if (item.file.startsWith('data:image/')) {
            isBase64 = true
            base64Content = item.file.split(',')[1] || ''
          } else if (item.file.startsWith('file://')) {
            isLocal = true
            localPath = item.file.replace(/^file:\/\//, '')
          } else if (path.isAbsolute(item.file) && fs.existsSync(item.file)) {
            isLocal = true
            localPath = item.file
          }
        }

        // 生成干净安全的文件名，防止 URL 字符污染文件系统路径
        let safeFileName = item.md5 ? `${item.md5}.jpg` : ''
        if (!safeFileName && typeof item.file === 'string' && !item.file.includes('/') && !item.file.includes('\\') && !item.file.startsWith('base64:')) {
          safeFileName = item.file.endsWith('.jpg') || item.file.endsWith('.png') || item.file.endsWith('.gif') || item.file.endsWith('.webp') ? item.file : `${item.file}.jpg`
        }
        if (!safeFileName) {
          const hashSeed = imageUrl || base64Content || localPath || Math.random().toString()
          safeFileName = `${crypto.createHash('md5').update(hashSeed).digest('hex')}.jpg`
        }

        const targetSavePath = path.join(fullReceivedDir, safeFileName)
        log.info(`[chronicle-plugin] 📷 收到来自 [${groupName || '私聊'}] ${senderNick}(${userId}) 的图片: ${safeFileName}`)

        // 将图片保存到本地缓存
        if (fs.existsSync(targetSavePath)) {
          log.info(`[chronicle-plugin] 图片本地缓存已存在: ${safeFileName}`)
        } else if (isBase64 && base64Content) {
          fs.writeFileSync(targetSavePath, Buffer.from(base64Content, 'base64'))
          log.info(`[chronicle-plugin] 图片从 Base64 写入缓存: ${safeFileName}`)
        } else if (isLocal && localPath && fs.existsSync(localPath)) {
          if (path.resolve(localPath) !== path.resolve(targetSavePath)) {
            fs.copyFileSync(localPath, targetSavePath)
          }
          log.info(`[chronicle-plugin] 图片从本地路径复制到缓存: ${safeFileName}`)
        } else if (imageUrl) {
          log.info(`[chronicle-plugin] 正在后台下载远程图片: ${safeFileName}`)
          await downloadFile(imageUrl, safeFileName, false, true, null, 10000)
          log.info(`[chronicle-plugin] ⬇️ 图片下载成功: ${safeFileName}`)
        }

        if (item.file !== safeFileName) {
          item.file = safeFileName
          hasImageUpdates = true
        }

        // 1. 检查 Meilisearch 中是否已有相同图片及其打标记录
        let filterStr = `message.type = "image" AND message.file = "${safeFileName}"`
        if (item.md5) {
          filterStr = `message.type = "image" AND (message.file = "${safeFileName}" OR message.md5 = "${item.md5}")`
        }

        const findRes = await MeiliClient.getIndex().search('', {
          filter: filterStr,
          limit: 5
        })

        let existSameImage = null
        for (const hit of findRes.hits || []) {
          const target = (hit.message || []).find(i =>
            (i.file === safeFileName || (item.md5 && i.md5 === item.md5)) && i.description
          )
          if (target) {
            existSameImage = target
            break
          }
        }

        // 2. 若已有描述，直接复用已有的 tags 与 description，节省 Token
        if (existSameImage) {
          log.info(`[chronicle-plugin] 🎯 图片已存在历史标注，直接复用: ${safeFileName} (tags: [${(existSameImage.tags || []).join(', ')}])`)
          item.description = existSameImage.description
          item.tags = existSameImage.tags || existSameImage.tag || []
          hasImageUpdates = true
        } else {
          // 3. 检查是否配置了 Vision AI 的 API Key
          const visionApiKey = Config.get('ai.vision.apiKey', '')
          if (!visionApiKey) {
            log.warn(`[chronicle-plugin] ⚠️ 未配置视觉模型 API Key (ai.vision.apiKey)，跳过自动打标: ${safeFileName}`)
          } else if (fs.existsSync(targetSavePath)) {
            // 4. 调用视觉大模型进行分析与打标
            const buffer = fs.readFileSync(targetSavePath)
            const type = await fileTypeFromBuffer(buffer)
            const mime = type?.mime || 'image/jpeg'
            const base64Str = buffer.toString('base64')
            const dataUrl = `data:${mime};base64,${base64Str}`

            const visionModel = Config.get('ai.vision.model', 'gpt-4o-mini')
            log.info(`[chronicle-plugin] 🤖 正在后台调用视觉模型 [${visionModel}] 分析图片 [${safeFileName}]...`)
            const { tags, description } = await describeImageWithRetry(dataUrl)
            item.tags = tags
            item.description = description
            hasImageUpdates = true
            log.info(`[chronicle-plugin] ✅ 图片分析完成 [${safeFileName}]: tags=[${tags.join(', ')}] desc="${description}"`)
          }
        }
      } catch (error) {
        log.error(`[chronicle-plugin] 后台处理图片异常:`, error)
      }
    } else if (item.type === 'video') {
      if (!saveVideo) {
        log.debug?.(`[chronicle-plugin] 配置为不保存群聊视频，跳过下载: ${item.name || item.file || ''}`)
        continue
      }
      try {
        let videoUrl = item.url || (typeof item.file === 'string' && /^https?:\/\//i.test(item.file) ? item.file : '')
        if (!videoUrl && e.video?.url) {
          videoUrl = e.video.url
        }
        const videoName = item.name || (item.fid ? `${item.fid}.mp4` : (item.file && item.file.endsWith('.mp4') ? item.file : ''))
        const safeVideoName = videoName || `${crypto.createHash('md5').update(videoUrl || Math.random().toString()).digest('hex')}.mp4`

        if (videoUrl) {
          log.info(`[chronicle-plugin] 🎬 正在后台下载群聊视频: ${safeVideoName}`)
          await downloadFile(videoUrl, safeVideoName, false, true, null, 60000)
          log.info(`[chronicle-plugin] 🎬 视频下载完成: ${safeVideoName}`)
        }
      } catch (err) {
        log.error(`[chronicle-plugin] 下载视频异常:`, err)
      }
    } else if (item.type === 'file') {
      if (!saveFile) {
        log.debug?.(`[chronicle-plugin] 配置为不保存群文件，跳过下载: ${item.name || item.fid || ''}`)
        continue
      }
      try {
        // 检查文件大小限制
        if (item.size && item.size > maxFileSizeBytes) {
          log.warn(`[chronicle-plugin] ⚠️ 群文件 [${item.name}] 大小 (${(item.size / 1024 / 1024).toFixed(1)}MB) 超过限制 (${maxFileSizeMB}MB)，跳过下载`)
          continue
        }

        let fileUrl = item.url
        if (!fileUrl && e.group?.getFileUrl && item.fid) {
          fileUrl = await e.group.getFileUrl(item.fid)
        } else if (!fileUrl && e.friend?.getFileUrl && item.fid) {
          fileUrl = await e.friend.getFileUrl(item.fid)
        }
        if (fileUrl && item.name) {
          log.info(`[chronicle-plugin] 📁 正在后台下载群文件: ${item.name}`)
          await downloadFile(fileUrl, item.name, false, true, null, 60000)
          log.info(`[chronicle-plugin] 📁 文件下载完成: ${item.name}`)
        }
      } catch (err) {
        log.error(`[chronicle-plugin] 下载文件异常:`, err)
      }
    }
  }

  // 若图片产生了打标或属性更新，异步更新回 Meilisearch 索引文档
  if (hasImageUpdates) {
    await MeiliClient.getIndex().updateDocuments([messageData])
    log.info(`[chronicle-plugin] 🏷️ 消息图片标注已更新入库: ${messageData.id}`)
  }
}

/**
 * 绑定全局消息监听器
 * 无论是在 Miao-Yunzai 还是 TRSS-Yunzai（含 OneBot/Lagrange/WeChat 等各种适配器），
 * Bot.on('message') 均可无损截获全量原始群聊与私聊消息。
 */
function bindMessageListener () {
  if (global.Bot && !isListenerBound) {
    isListenerBound = true
    global.Bot.on('message', handleMessage)
    const log = global.logger || console
    log.info('[chronicle-plugin] 全局消息监听器已就绪 (支持 TRSS / Miao 及各类适配器)')
  }
}

if (typeof global.Bot !== 'undefined') {
  bindMessageListener()
}

export class Indexer extends plugin {
  constructor () {
    super({
      name: 'meilisearch-indexer',
      dsc: 'Meilisearch 消息索引入库应用',
      event: 'message',
      priority: -999999
    })
    bindMessageListener()
  }
}
