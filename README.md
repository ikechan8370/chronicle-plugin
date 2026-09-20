# 群聊编年史 (chronicle-plugin)

基于 [Meilisearch](https://www.meilisearch.com/) 搜索引擎构建的 Miao-Yunzai / Yunzai-Bot 标准插件，提供群聊消息实时入库、视觉模型自动打标、多媒体去重、全文检索、艾特社交网络拓扑可视化、词云生成与 AI 用户画像等功能。

---

## ✨ 核心特性

- 🚀 **内置 Meilisearch 二进制**：
  - 无需手动安装 Docker 或外部部署，插件启动时自动检测运行平台（Windows / Linux / macOS，支持 x64 与 arm64）。
  - 支持自动从 GitHub Release 下载对应预编译二进制，并由插件托管生命周期（开机启动、健康检查、日志同步、关机优雅退出）。
  - 支持切换为外部独立部署的 Meilisearch 实例（`embedded: false`）。
- 🖥️ **内置 WebUI 管理面板**：
  - 独立运行的轻量级后台管理面板（默认端口 `7701`），支持直接通过浏览器查看与检索已索引的群聊消息。
  - 支持毫秒级全文检索、消息类型过滤（文本/图片/文件）、时间与活跃度排序。
  - 支持直接预览群聊缓存的图片与媒体、查看 Vision AI 打标结果与原始 JSON 文档。
  - 具备数据统计大屏（文档总数、活跃发言人、热门群聊、标签分布）与安全 Token 鉴权机制。
- 🔌 **多框架与多适配器全兼容**：
  - 同时原生兼容 **Miao-Yunzai** 与 **TRSS-Yunzai**。
  - 适配 **ICQQ**、**OneBot v11**、**Lagrange**、**Satori**、**QQ频道** 等多种主流适配器，统一格式规范化入库。
- 🖼️ **多媒体智能处理与视觉打标**：
  - 群聊图片与表情包自动下载并利用 MD5 / 文件指纹去重。
  - 新图片自动调用 Vision AI（如 Qwen-VL、GPT-4o）生成高准确度描述与关键词 tags，赋能自然语言搜索表情包与图片。
- 📊 **丰富的数据分析与可视化**：
  - **社交拓扑关系图谱**：基于群内艾特网络，利用 Leiden 社区发现算法和力导向拓扑生成高清星系社交关系图与个人专属雷达看板。
  - **历史与今日词云**：支持结巴分词、停用词过滤与自适应布局，可生成全群或个人的今日/历史高频热词云图。
  - **表情包与图片溯源**：查出某张图在群聊中的最早发送者、总使用次数与各群友发送频次排行。
- 🎭 **AI 风格学舌与人物画像**：
  - 检索目标群友的历史发言风格，结合大语言模型模仿其语气、口癖进行对话（学舌）。
  - 自动汇总用户近期发言、高频词汇与互动特征，生成幽默风趣的人物画像并赋诗一首。
- ⚙️ **配置与管理**：
  - 支持标准 YAML 配置文件持久化。
  - 深度集成 **锅巴插件（Guoba-Plugin）**，支持通过网页图形化后台轻松修改各项 API 密钥与模型参数。

---

## 📦 安装方法

进入 Yunzai 根目录的 `plugins` 文件夹下克隆本项目：

```bash
# 进入云崽插件目录
cd plugins

# 克隆插件
git clone https://github.com/ikechan8370/chronicle-plugin.git

# 安装依赖
pnpm install --filter=chronicle-plugin
# 或
cd chronicle-plugin && npm install
```

---

## 🛠️ 配置说明

配置文件位于 `plugins/chronicle-plugin/config/config.yaml`（首次启动时会自动根据 `default_config.yaml` 生成），也可以直接在 **锅巴插件后台** 中进行修改：

```yaml
# Meilisearch 搜索引擎配置
meilisearch:
  # 是否启用内置二进制服务（true: 自动下载和运行内置进程；false: 连接外部实例）
  embedded: true
  # 监听地址与端口
  host: "127.0.0.1"
  port: 7700
  # API 密钥 / Master Key（首次启动若为空会自动生成安全的 48 位密钥）
  apiKey: ""
  # 缺失二进制时是否自动从 GitHub 下载
  autoDownload: true
  # GitHub 加速镜像前缀（国外服务器或直连环境会自动回退直连）
  downloadProxy: "https://mirror.ghproxy.com/"
  # 数据文件保存路径
  dbPath: "./data/meilisearch/data.ms"
  indexName: "messages"

# 内置管理面板 WebUI
dashboard:
  enable: true
  host: "0.0.0.0"
  port: 7701
  # 访问 Token，为空时默认使用 meilisearch.apiKey
  authKey: ""

# AI 大模型配置
ai:
  # 视觉大模型 (用于图片理解与 tags 提取)
  vision:
    provider: "openai" # 'openai' 或 'gemini'
    baseUrl: "https://api.openai.com/v1"
    apiKey: "sk-..."
    model: "gpt-4o-mini"
    supportsResponseFormat: false
    maxRetry: 3

  # 对话大模型 (用于 #学舌、#画像、#群画像)
  chat:
    provider: "openai" # 'openai' 或 'gemini'
    openai:
      baseUrl: "https://api.openai.com/v1"
      apiKey: "sk-..."
      model: "gpt-4o-mini"
      maxTokens: 4096
    gemini:
      baseUrl: "https://generativelanguage.googleapis.com/v1beta"
      apiKey: "your_gemini_key"
      repeatModel: "gemini-2.0-flash"
      descModel: "gemini-2.0-flash"

# 词云配置
wordcloud:
  historyLimit: 50000
  todayLimit: 5000
  maxLimit: 500000
  historyWords: 130
  todayWords: 100

# 文件存储路径
storage:
  receivedDir: "./data/chronicle/received"
```

---

## 📖 指令列表

| 指令 | 说明 | 示例 |
|---|---|---|
| `#搜索图片 [关键词]` | 搜索群内或全库匹配描述的图片 | `#搜索图片 猫猫`、`#全部搜索图片 柴犬 第2页` |
| `#搜索表情包 [关键词]` | 搜索群内或全库表情包 | `#搜索表情包 哭哭` |
| `#我的发言` / `#他的发言 [@某人]` | 查询指定用户的发言记录 | `#我的发言`、`#他的发言 @群友 第2页` |
| `#搜索发言 [关键词]` | 关键词全文检索群聊记录 | `#搜索发言 今天吃什么`、`#搜索我的发言 晚安` |
| `#总结tag` / `#总结发言` / `#总结表情包` | 聚合统计群内热门标签、话痨榜、最爱用表情 | `#总结发言`、`#总结表情包` |
| `#图片溯源` / `#谁发过这张图` | 引用或直接发送图片，查询首发人与历史统计 | 回复图片并发送 `#图片溯源` |
| `#艾特统计` / `#谁最喜欢艾特我` | 统计群内艾特排行与特定对象的艾特频次 | `#艾特统计`、`#谁最喜欢艾特我` |
| `#艾特图谱` / `#个人艾特图谱` | 生成全群社交网络拓扑图或个人专属雷达看板 | `#艾特图谱`、`#我的艾特图谱`、`#艾特图谱 随机` |
| `#词云` / `#今日词云` | 生成群聊或指定个人的高频词云图 | `#今日词云`、`#词云 个人`、`#词云 随机` |
| `#学舌 [@某人]` | 抓取历史发言，由 AI 模仿该群友风格对话 | `#学舌 @群友`、`#随机学舌` |
| `#画像 [@某人]` | 由 AI 生成群友的性格、口癖与综合人物画像 | `#画像 @群友`、`#随机画像` |
| `#群画像` | 总结群内近期的热议主题与整体氛围 | `#群画像` |
| `#tag [标签1,标签2]` | 为指定图片手动添加或修改标签 | 回复图片并发送 `#tag 可爱,猫咪` |
| `#query [meili_filter]` | （主人权限）执行原始 Meilisearch 查询调试 | `#query /{"limit": 10}` |

---

## 📄 开源许可

本项目遵循 [MIT License](LICENSE)。
