import OpenAI from 'openai'
import fetch from 'node-fetch'
import Config from './config.js'

/**
 * 视觉大模型：识别图片并返回标签与描述
 */
export async function describeImageWithRetry (image, maxRetry = 3) {
  const apiKey = Config.get('ai.vision.apiKey', '')
  let baseURL = Config.get('ai.vision.baseUrl', 'https://api.openai.com/v1')
  baseURL = baseURL.replace(/\/chat\/completions\/?$/, '')

  const modelName = Config.get('ai.vision.model', 'gpt-4o-mini')
  const retryCount = Config.get('ai.vision.maxRetry', maxRetry)
  const supportsResponseFormat = Config.get('ai.vision.supportsResponseFormat', false)
  const log = global.logger || console

  const client = new OpenAI({
    apiKey,
    baseURL,
    defaultHeaders: {
      'x-request-from': 'chronicle-plugin/ImageDesc'
    }
  })

  for (let retry = 0; retry < retryCount; retry++) {
    try {
      const params = {
        model: modelName,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: image,
                  detail: 'high'
                }
              },
              {
                type: 'text',
                text: '描述一下这个图片，返回描述文本和对应的tags。tags和文本不宜过多。tags一般不超过5个。描述不超过50字，除非图片中有文字需要复述。描述文本和tags都应该有助于通过关键词检索到该张图片。如果图片中有文字，应该将文字包含在描述中，如果文字较多可以只包含概述。要求返回json格式，包含两个字段 `tags` (list[str])和 `description` (str).优先使用简体中文进行描述。返回内容必须是完整json字符串且不包含任何其他字符。'
              }
            ]
          }
        ]
      }

      if (supportsResponseFormat) {
        params.response_format = { type: 'json_object' }
      }

      const response = await client.chat.completions.create(params)
      const choice = response.choices?.[0]
      if (!choice?.message?.content) {
        throw new Error('视觉模型返回内容为空')
      }

      let content = choice.message.content.trim()
      content = content.replace(/```json/gi, '').replace(/```/g, '').trim()

      const parsed = JSON.parse(content)
      return {
        tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        description: String(parsed.description || '')
      }
    } catch (error) {
      const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message
      log.error(`[chronicle-plugin] 视觉模型 ${modelName} 第 ${retry + 1} 次识别失败: ${errorMsg}`)
      if (retry === retryCount - 1) {
        throw new Error(`视觉模型 ${modelName} 达到最大重试次数: ${errorMsg}`)
      }
      await new Promise(r => setTimeout(r, 1000))
    }
  }
}

/**
 * 统一对话模型调用（学舌、用户画像、群画像）
 * @param {string} prompt 用户提示词
 * @param {string} systemPrompt 系统提示词
 * @param {string} type 'repeat' | 'desc'
 */
export async function callChat (prompt, systemPrompt, type = 'desc') {
  const cfg = Config.getConfig().ai?.chat || {}
  const provider = cfg.provider || 'openai'

  if (provider === 'gemini') {
    const geminiConf = cfg.gemini || {}
    const model = type === 'repeat' ? (geminiConf.repeatModel || 'gemini') : (geminiConf.descModel || 'gemini')
    return callGemini(prompt, systemPrompt, model)
  } else {
    return callOpenAI(prompt, systemPrompt)
  }
}

/**
 * 调用 Google Gemini API
 */
export async function callGemini (prompt, systemPrompt, model = 'gemini') {
  const cfg = Config.getConfig().ai?.chat?.gemini || {}
  if (!cfg.apiKey) throw new Error('Gemini API Key 未配置')

  const url = `${cfg.baseUrl.replace(/\/+$/, '')}/models/${model}:generateContent?key=${cfg.apiKey}`
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    system_instruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 1,
      maxOutputTokens: 8192
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Gemini API Error: ${response.status} - ${errText}`)
  }

  const data = await response.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text || ''
}

/**
 * 调用 OpenAI 兼容格式 API
 */
export async function callOpenAI (prompt, systemPrompt) {
  const cfg = Config.getConfig().ai?.chat?.openai || {}
  if (!cfg.apiKey) throw new Error('OpenAI API Key 未配置')

  let baseUrl = cfg.baseUrl || 'http://151.244.214.140:52389/v1'
  if (!baseUrl.endsWith('/v1')) {
    baseUrl = baseUrl.replace(/\/+$/, '') + '/v1'
  }
  const url = `${baseUrl}/chat/completions`

  const payload = {
    model: cfg.model || 'gemini-3.5-flash',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: 1,
    max_tokens: cfg.maxTokens || 4096,
    stream: false
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiKey}`
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`OpenAI API Error: ${response.status} - ${errText}`)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}
