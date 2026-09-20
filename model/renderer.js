const PLUGIN_NAME = 'chronicle-plugin'

/**
 * 渲染词云图片
 */
export async function renderWordCloud (e, data) {
  const log = global.logger || console
  try {
    if (!e.runtime?.render) return false
    return await e.runtime.render(PLUGIN_NAME, 'wordcloud/index', data, {
      retType: 'base64',
      beforeRender: ({ data }) => ({
        ...data,
        pageGotoParams: {
          timeout: 120000,
          waitUntil: 'networkidle0'
        }
      })
    })
  } catch (err) {
    log.error(`[${PLUGIN_NAME}] 词云图片生成失败:`, err)
    return false
  }
}

/**
 * 渲染个人艾特关系图
 */
export async function renderPersonalAtGraph (e, data) {
  const log = global.logger || console
  try {
    if (!e.runtime?.render) return false
    return await e.runtime.render(PLUGIN_NAME, 'atgraph/personal', data, {
      retType: 'base64',
      beforeRender: ({ data }) => ({
        ...data,
        pageGotoParams: {
          timeout: 120000,
          waitUntil: 'networkidle0'
        }
      })
    })
  } catch (err) {
    log.error(`[${PLUGIN_NAME}] 个人艾特关系图渲染失败:`, err)
    return false
  }
}

/**
 * 渲染全群艾特关系图
 */
export async function renderAtGraph (e, data) {
  const log = global.logger || console
  try {
    if (!e.runtime?.render) return false
    return await e.runtime.render(PLUGIN_NAME, 'atgraph/index', data, {
      retType: 'base64',
      beforeRender: ({ data }) => ({
        ...data,
        pageGotoParams: {
          timeout: 120000,
          waitUntil: 'networkidle0'
        }
      })
    })
  } catch (err) {
    log.error(`[${PLUGIN_NAME}] 艾特关系图渲染失败:`, err)
    return false
  }
}
