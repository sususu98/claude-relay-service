# Claude Relay Service 项目概述

## 🚀 核心功能
- **多平台AI代理服务**: 支持 Claude (Anthropic)、Gemini (Google)、OpenAI 等多个AI服务商
- **OAuth认证流程**: 完整的PKCE OAuth 2.0实现，支持Claude Code账户认证
- **多账户管理**: 智能账户调度、负载均衡、自动故障切换
- **API Key管理**: 自建API Key系统，支持配额控制、使用统计、权限管理
- **代理支持**: 每个账户独立代理配置，支持SOCKS5/HTTP代理

## 🏗️ 技术架构
- **后端框架**: Express.js + Node.js 18+
- **数据存储**: Redis (IORedis) - 账户数据、会话、统计、缓存
- **安全机制**: JWT认证、AES数据加密、BCrypt密码哈希
- **前端界面**: Vue 3 + Vite SPA，支持明暗主题切换
- **部署方式**: Docker Compose + 可选监控栈

## 📁 项目结构
```
├── src/                    # 后端核心代码
│   ├── services/          # 业务服务层 (Claude/Gemini账户管理)
│   ├── routes/            # API路由定义
│   ├── middleware/        # 中间件 (认证、限流、日志)
│   ├── models/            # 数据模型 (Redis操作)
│   └── utils/             # 工具函数 (日志、加密、代理)
├── web/admin-spa/         # 前端管理界面
├── scripts/               # 部署和管理脚本
├── cli/                   # 命令行工具
├── config/                # 配置文件
└── docs/                  # 项目文档
```

## 🔄 核心业务流程
1. **请求认证**: 客户端API Key验证 → 速率限制检查
2. **账户选择**: 智能选择可用Claude/Gemini账户
3. **Token管理**: 自动检查并刷新OAuth access token
4. **请求转发**: 移除客户端认证头，添加OAuth Bearer token
5. **代理传输**: 通过配置的代理发送到目标AI服务
6. **流式响应**: 支持SSE流式传输，实时使用统计记录

## 📊 并发性能
- **当前配置**: 单进程Express，Redis连接池
- **理论上限**: 200-500并发连接
- **优化方向**: PM2集群、Fastify升级、Go微服务重构

## 🛡️ 安全特性
- **数据加密**: 敏感数据AES-256加密存储
- **零信任架构**: 每个请求完整认证链验证  
- **代理隔离**: 账户级别的网络代理隔离
- **审计日志**: 完整的请求链路日志记录