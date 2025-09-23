# 常用开发命令

## 🚀 基础开发命令

### 依赖管理
```bash
npm install                    # 安装后端依赖
npm run install:web           # 安装前端依赖 (web/admin-spa)
```

### 开发和运行
```bash
npm run dev                   # 开发模式 (nodemon 热重载)
npm start                     # 生产模式 (先 lint 后启动)
npm run setup                 # 初始化配置和管理员凭据
```

### 代码质量
```bash
npm run lint                  # ESLint 检查并自动修复
npm run lint:check            # 仅检查，不自动修复
npm run format                # Prettier 格式化所有文件
npm run format:check          # 检查格式化状态
npm test                      # 运行 Jest 测试套件
```

## 🏗️ 构建和部署

### 前端构建
```bash
npm run build:web             # 构建管理界面 SPA
```

### Docker 部署
```bash
npm run docker:build          # 构建 Docker 镜像
npm run docker:up             # 启动 Docker Compose
npm run docker:down           # 停止 Docker Compose
```

## 🔧 服务管理

### PM2 服务控制
```bash
npm run service:start         # 前台启动服务
npm run service:start:daemon  # 后台启动服务 (推荐)
npm run service:stop          # 停止服务
npm run service:restart       # 重启服务
npm run service:status        # 查看服务状态
npm run service:logs          # 查看实时日志
npm run service:logs:follow   # 跟踪日志输出
```

### 系统监控
```bash
npm run monitor               # 增强监控脚本
npm run status                # 统一状态检查
npm run status:detail         # 详细状态信息
```

## 🎯 CLI 工具

### API Key 管理
```bash
npm run cli keys create -- --name "客户端名称" --limit 100000
npm run cli keys list
npm run cli keys delete -- --id <key-id>
```

### 账户管理
```bash
npm run cli accounts list     # 列出所有 Claude 账户
npm run cli accounts refresh <account-id>  # 手动刷新 token
```

### 管理员操作
```bash
npm run cli admin create -- --username <用户名>
npm run cli admin reset-password -- --username <用户名>
```

### 系统状态
```bash
npm run cli status            # 系统运行状态
npm run cli                   # 显示所有可用命令
```

## 📊 数据管理

### 数据迁移
```bash
npm run migrate:apikey-expiry          # 迁移 API Key 过期时间
npm run migrate:apikey-expiry:dry      # 迁移预演（不实际执行）
npm run migrate:fix-usage-stats       # 修复使用统计数据
```

### 数据导入导出
```bash
npm run data:export                    # 导出所有数据
npm run data:export:sanitized         # 导出脱敏数据
npm run data:export:enhanced           # 增强导出（解密版本）
npm run data:export:encrypted          # 导出加密数据
npm run data:import                    # 导入数据
npm run data:import:enhanced           # 增强导入
npm run data:debug                     # 调试 Redis 键值
```

## 🧪 测试和调试

### 功能测试
```bash
npm run test:pricing-fallback          # 测试价格回退机制
npm run update:pricing                 # 更新模型价格数据
```

### 成本初始化
```bash
npm run init:costs                     # 初始化所有 API Key 的成本数据
```

## ⚙️ 配置文件位置

### 重要配置文件
- `config/config.js` - 主配置文件
- `.env` - 环境变量配置
- `data/init.json` - 管理员初始化数据
- `ecosystem.config.js` - PM2 进程配置 (需创建)
- `docker-compose.yml` - Docker 编排配置

### 开发环境设置
```bash
cp config/config.example.js config/config.js
cp .env.example .env
# 编辑配置文件后运行
npm run setup
```

## 🔍 故障排除

### 常见问题解决
```bash
# Redis 连接问题
redis-cli ping

# 端口占用检查
lsof -i :3000

# 服务日志查看
tail -f logs/claude-relay-*.log

# PM2 进程状态
pm2 status
pm2 logs claude-relay
```

### 性能优化命令
```bash
# 启用集群模式 (创建 ecosystem.config.js 后)
pm2 start ecosystem.config.js
pm2 reload all                # 零停机重启

# 监控系统资源
pm2 monit
```