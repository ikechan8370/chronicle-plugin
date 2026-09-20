import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'
import _ from 'lodash'

import { fileURLToPath } from 'node:url'

const PLUGIN_NAME = 'chronicle-plugin'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_PATH = path.resolve(__dirname, '..')

class Config {
  constructor () {
    this.configPath = path.join(PLUGIN_PATH, 'config', 'config.yaml')
    this.defaultPath = path.join(PLUGIN_PATH, 'config', 'default_config.yaml')
    this.config = null
  }

  /**
   * 获取当前配置
   */
  getConfig () {
    if (!this.config) {
      this.init()
    }
    return this.config
  }

  /**
   * 初始化并读取配置
   */
  init () {
    let defaultConfig = {}
    if (fs.existsSync(this.defaultPath)) {
      try {
        defaultConfig = YAML.parse(fs.readFileSync(this.defaultPath, 'utf8')) || {}
      } catch (err) {
        console.error(`[${PLUGIN_NAME}] 读取默认配置失败:`, err)
      }
    }

    let userConfig = {}
    if (fs.existsSync(this.configPath)) {
      try {
        userConfig = YAML.parse(fs.readFileSync(this.configPath, 'utf8')) || {}
      } catch (err) {
        console.error(`[${PLUGIN_NAME}] 读取用户配置失败，将使用默认配置:`, err)
      }
    } else {
      // 若用户配置文件不存在，由默认配置创建
      try {
        fs.mkdirSync(path.dirname(this.configPath), { recursive: true })
        fs.writeFileSync(this.configPath, YAML.stringify(defaultConfig), 'utf8')
      } catch (err) {
        console.error(`[${PLUGIN_NAME}] 创建用户配置文件失败:`, err)
      }
    }

    // 规范化配置：将所有带点的扁平键（如 'ai.vision.apiKey'）展开合并进嵌套对象中
    const merged = _.cloneDeep(defaultConfig)
    for (const [k, v] of Object.entries(userConfig)) {
      if (!k.includes('.')) {
        if (_.isPlainObject(v) && _.isPlainObject(merged[k])) {
          merged[k] = _.merge({}, merged[k], v)
        } else {
          merged[k] = v
        }
      }
    }

    // 扁平点号键具有最高优先级，展开写入
    for (const [k, v] of Object.entries(userConfig)) {
      if (k.includes('.')) {
        _.set(merged, k, v)
      }
    }

    this.defaultConfig = defaultConfig
    this.config = merged
    return this.config
  }

  /**
   * 获取指定配置项
   * @param {string} key 配置键名（支持 a.b.c 路径）
   * @param {*} defaultValue 默认值
   */
  get (key, defaultValue = undefined) {
    if (!this.config) {
      this.init()
    }
    const val = _.get(this.config, key)
    if (val !== undefined && val !== null && val !== '') {
      return val
    }
    const defVal = _.get(this.defaultConfig, key)
    return defVal !== undefined ? defVal : defaultValue
  }

  /**
   * 保存配置
   * @param {object} newConfig
   */
  saveConfig (newConfig) {
    try {
      if (!this.config) {
        this.init()
      }
      for (const [k, v] of Object.entries(newConfig)) {
        if (k.includes('.')) {
          _.set(this.config, k, v)
        } else if (_.isPlainObject(v) && _.isPlainObject(this.config[k])) {
          this.config[k] = _.merge({}, this.config[k], v)
        } else {
          this.config[k] = v
        }
      }
      fs.writeFileSync(this.configPath, YAML.stringify(this.config), 'utf8')
      return true
    } catch (err) {
      console.error(`[${PLUGIN_NAME}] 保存配置文件失败:`, err)
      return false
    }
  }

  /**
   * 判断指定群聊是否启用了消息索引/功能
   * @param {string|number} groupId 群号
   * @returns {boolean}
   */
  isGroupEnabled (groupId) {
    groupId = String(groupId || '')
    if (!groupId || groupId === '0') return false

    const groupCfg = this.get('groups', {})
    const rules = groupCfg.rules || {}

    // 1. 若在 rules 中明确指定了该群的 enabled 状态，优先级最高
    if (rules[groupId] && typeof rules[groupId].enabled === 'boolean') {
      return rules[groupId].enabled
    }

    const mode = groupCfg.mode || 'all'
    const whitelist = (groupCfg.whitelist || []).map(String)
    const blacklist = (groupCfg.blacklist || []).map(String)

    // 2. 黑名单判定
    if (blacklist.includes(groupId)) {
      return false
    }

    // 3. 白名单模式判定
    if (mode === 'whitelist') {
      return whitelist.includes(groupId)
    }

    // 4. 'all' 或 'blacklist' 模式下默认开启
    return true
  }

  /**
   * 获取指定群的多媒体存储策略
   * @param {string|number} groupId 群号
   * @returns {{ saveImage: boolean, saveVideo: boolean, saveFile: boolean, vision: boolean, maxFileSizeMB: number }}
   */
  getGroupMediaRule (groupId) {
    groupId = String(groupId || '')
    const storageCfg = this.get('storage', {})
    const groupRule = this.get(`groups.rules.${groupId}`, {})

    return {
      saveImage: groupRule.saveImage ?? storageCfg.saveImage ?? true,
      saveVideo: groupRule.saveVideo ?? storageCfg.saveVideo ?? false,
      saveFile: groupRule.saveFile ?? storageCfg.saveFile ?? false,
      vision: groupRule.vision ?? true,
      maxFileSizeMB: groupRule.maxFileSizeMB ?? storageCfg.maxFileSizeMB ?? 50
    }
  }
}

export default new Config()
