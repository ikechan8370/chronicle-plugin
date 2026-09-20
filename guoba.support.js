import Config from './model/config.js'

export function supportGuoba () {
  return {
    pluginInfo: {
      name: 'chronicle-plugin',
      title: '群聊编年史 (Chronicle)',
      author: ['@ikechan8370'],
      authorLink: ['https://github.com/ikechan8370'],
      link: 'https://github.com/ikechan8370/chronicle-plugin',
      isV3: true,
      isV2: false,
      showInMenu: true,
      description: '云崽群聊编年史与多模态检索插件：支持全量消息索引、Vision AI 图片自动打标、全文/表情包检索、社交图谱、词云分析与群友画像，兼容 TRSS / Miao-Yunzai 多适配器',
      icon: 'carbon:catalog',
      iconColor: '#2563eb'
    },
    configInfo: {
      schemas: [
        {
          component: 'Divider',
          label: 'Meilisearch 搜索引擎配置'
        },
        {
          field: 'meilisearch.embedded',
          label: '启用内置二进制',
          bottomHelpMessage: '开启后将自动管理和运行内置 Meilisearch 进程（无需手动装 Docker 或外部服务）；若关闭，请配置下方外部地址',
          component: 'Switch'
        },
        {
          field: 'meilisearch.autoDownload',
          label: '自动下载二进制',
          bottomHelpMessage: '当 bin/ 目录下不存在 Meilisearch 时，首次启动是否自动从 GitHub Releases 下载预编译文件',
          component: 'Switch'
        },
        {
          field: 'meilisearch.downloadProxy',
          label: 'GitHub 加速代理',
          bottomHelpMessage: '国内服务器下载加速前缀，例如 https://mirror.ghproxy.com/（留空则直接连 GitHub）',
          component: 'Input',
          componentProps: {
            placeholder: 'https://mirror.ghproxy.com/'
          }
        },
        {
          field: 'meilisearch.host',
          label: '服务主机地址',
          bottomHelpMessage: '内置服务建议保持 127.0.0.1，外部服务请填对应 IP 或域名',
          component: 'Input',
          componentProps: {
            placeholder: '127.0.0.1'
          },
          required: true
        },
        {
          field: 'meilisearch.port',
          label: '服务端口',
          bottomHelpMessage: 'Meilisearch 监听端口，默认 7700',
          component: 'InputNumber',
          componentProps: {
            min: 1,
            max: 65535,
            placeholder: 7700
          },
          required: true
        },
        {
          field: 'meilisearch.apiKey',
          label: 'API Key / Master Key',
          bottomHelpMessage: '内置服务启动密钥或外部 Meilisearch 的认证 Key。若留空，内置服务首次启动将自动生成随机安全密钥',
          component: 'InputPassword',
          componentProps: {
            placeholder: '留空将自动生成安全 Master Key'
          }
        },
        {
          field: 'meilisearch.indexName',
          label: '消息索引名称',
          component: 'Input',
          componentProps: {
            placeholder: 'messages'
          },
          required: true
        },
        {
          field: 'meilisearch.maxIndexingMemory',
          label: '最大索引内存限制 (低配调优)',
          bottomHelpMessage: '专为 1G-4G 内存 VPS 调优，防止默认占用 2/3 系统内存导致 OOM。推荐 256MiB',
          component: 'Select',
          componentProps: {
            options: [
              { label: '128MiB (极致省内存，适合 1G-2G VPS)', value: '128MiB' },
              { label: '256MiB (推荐，适合 2G-4G 服务器)', value: '256MiB' },
              { label: '512MiB (适合 4G-8G 服务器)', value: '512MiB' },
              { label: '1GiB (适合 8G+ 内存服务器)', value: '1GiB' },
              { label: '不限制 (系统物理内存的 2/3)', value: 'unlimited' }
            ]
          }
        },
        {
          field: 'meilisearch.maxIndexingThreads',
          label: '最大索引并发线程数',
          bottomHelpMessage: '默认 1。低配服务器建议保持 1，防止多核并发导致瞬时内存激增',
          component: 'InputNumber',
          componentProps: {
            min: 1,
            max: 16,
            placeholder: 1
          }
        },

        {
          component: 'Divider',
          label: '视觉大模型 (Vision AI) 自动搜图打标配置'
        },
        {
          field: 'ai.vision.baseUrl',
          label: '视觉接口 BaseURL',
          bottomHelpMessage: '兼容 OpenAI 协议的接口 BaseURL（如 https://api.openai.com/v1 或第三方中转站）',
          component: 'Input',
          componentProps: {
            placeholder: 'https://api.openai.com/v1'
          }
        },
        {
          field: 'ai.vision.apiKey',
          label: '视觉接口 API Key',
          bottomHelpMessage: '若留空，插件将仅缓存入库图片，不消耗 Token 进行视觉打标',
          component: 'InputPassword',
          componentProps: {
            placeholder: 'sk-...'
          }
        },
        {
          field: 'ai.vision.model',
          label: '视觉模型名称',
          bottomHelpMessage: '例如 gpt-4o-mini, gpt-4o, qwen-vl-max 等具备视觉能力的大模型',
          component: 'Input',
          componentProps: {
            placeholder: 'gpt-4o-mini'
          }
        },
        {
          field: 'ai.vision.supportsResponseFormat',
          label: '支持 JSON 模式',
          bottomHelpMessage: '如果所选模型支持 response_format: { type: "json_object" } 可开启以提高稳定性',
          component: 'Switch'
        },

        {
          component: 'Divider',
          label: '对话大模型 (Chat LLM) 配置（#学舌、#画像等）'
        },
        {
          field: 'ai.chat.provider',
          label: '服务商选择',
          component: 'Select',
          componentProps: {
            options: [
              { label: 'OpenAI 兼容协议 (DeepSeek / ChatGPT / 聚合中转)', value: 'openai' },
              { label: 'Google Gemini 官方协议', value: 'gemini' }
            ]
          }
        },
        {
          field: 'ai.chat.openai.baseUrl',
          label: 'OpenAI BaseURL',
          component: 'Input',
          componentProps: {
            placeholder: 'https://api.openai.com/v1'
          }
        },
        {
          field: 'ai.chat.openai.apiKey',
          label: 'OpenAI API Key',
          component: 'InputPassword',
          componentProps: {
            placeholder: 'sk-...'
          }
        },
        {
          field: 'ai.chat.openai.model',
          label: 'OpenAI 模型名称',
          component: 'Input',
          componentProps: {
            placeholder: 'gpt-4o-mini'
          }
        },
        {
          field: 'ai.chat.gemini.apiKey',
          label: 'Gemini API Key',
          component: 'InputPassword',
          componentProps: {
            placeholder: 'AIzaSy...'
          }
        },
        {
          field: 'ai.chat.gemini.baseUrl',
          label: 'Gemini BaseURL',
          component: 'Input',
          componentProps: {
            placeholder: 'https://generativelanguage.googleapis.com/v1beta'
          }
        },

        {
          component: 'Divider',
          label: '内置可视化管理面板 (Dashboard) 配置'
        },
        {
          field: 'dashboard.enable',
          label: '启用管理面板',
          bottomHelpMessage: '开启后将内置独立的 Web 管理面板，支持在浏览器中实时查看与检索索引消息、预览图片和 AI 标注',
          component: 'Switch'
        },
        {
          field: 'dashboard.port',
          label: '面板端口',
          bottomHelpMessage: '管理面板的访问端口，默认 7701',
          component: 'InputNumber',
          componentProps: {
            min: 1,
            max: 65535,
            placeholder: 7701
          }
        },
        {
          field: 'dashboard.authKey',
          label: '面板自定义密码',
          bottomHelpMessage: '访问面板时的认证 Token。若留空，则默认复用 Meilisearch API Key',
          component: 'InputPassword',
          componentProps: {
            placeholder: '留空默认使用 Meilisearch Key'
          }
        },

        {
          component: 'Divider',
          label: '词云与数据统计配置'
        },
        {
          field: 'wordcloud.historyLimit',
          label: '历史词云扫描上限',
          bottomHelpMessage: '生成历史词云时最大拉取的消息条数',
          component: 'InputNumber',
          componentProps: {
            placeholder: 50000
          }
        },
        {
          field: 'wordcloud.todayLimit',
          label: '今日词云扫描上限',
          bottomHelpMessage: '生成今日词云时最大拉取的消息条数',
          component: 'InputNumber',
          componentProps: {
            placeholder: 5000
          }
        },
        {
          field: 'storage.receivedDir',
          label: '多媒体缓存相对路径',
          bottomHelpMessage: '相对于云崽根目录的图片与文件存储路径，默认 ./data/chronicle/received',
          component: 'Input',
          componentProps: {
            placeholder: './data/chronicle/received'
          }
        },
        {
          field: 'storage.saveImage',
          label: '保存群聊图片到本地',
          bottomHelpMessage: '开启后下载群聊图片到本地，支持 Vision AI 打标与面板预览。默认开启',
          component: 'Switch'
        },
        {
          field: 'storage.saveVideo',
          label: '保存群聊视频到本地',
          bottomHelpMessage: '默认关闭。视频体积较大，开启后可能迅速占满磁盘空间',
          component: 'Switch'
        },
        {
          field: 'storage.saveFile',
          label: '保存群文件到本地',
          bottomHelpMessage: '默认关闭。群文件体积较大，开启后容易挤爆服务器硬盘',
          component: 'Switch'
        },
        {
          field: 'storage.maxFileSizeMB',
          label: '单个多媒体下载上限 (MB)',
          bottomHelpMessage: '超过该大小的文件或视频将跳过本地下载，默认 50MB',
          component: 'InputNumber',
          componentProps: {
            min: 1,
            max: 2048,
            placeholder: 50
          }
        }
      ],
      getConfigData () {
        return Config.getConfig()
      },
      setConfigData (data, { Result }) {
        Config.saveConfig(data)
        return Result.ok({}, '保存配置成功')
      }
    }
  }
}
