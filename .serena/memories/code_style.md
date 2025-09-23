# 代码风格和开发规范

## 🎯 核心技术栈
- **JavaScript (ES2022)**: 使用 CommonJS 模块，目标 Node.js 18+
- **代码质量**: ESLint (`eslint:recommended`) + Prettier 集成
- **格式化**: 自动格式化，支持 `npm run lint` 自动修复

## 📝 编码规范

### JavaScript 风格
- **变量声明**: 优先使用 `const`，必要时使用 `let`，禁用 `var`
- **函数定义**: 优先使用箭头函数，复杂逻辑使用 function 声明
- **比较操作**: 强制使用 `===` 和 `!==` (ESLint `eqeqeq` 规则)
- **异步处理**: 优先使用 `async/await`，避免回调地狱

### 命名约定
- **文件名**: 小写+下划线 (`claude_account_service.js`)
- **变量/函数**: 驼峰命名 (`getUserInfo`, `isConnected`)
- **常量**: 大写+下划线 (`API_VERSION`, `DEFAULT_TIMEOUT`)
- **类名**: 帕斯卡命名 (`RedisClient`, `ApiKeyService`)

### 注释风格
- **简洁明了**: 中文注释可接受，emoji 增强可读性 🎯
- **函数注释**: 描述作用和重要参数，避免冗余
- **业务逻辑**: 复杂算法必须注释，解释"为什么"而非"是什么"

```javascript
// ✅ 好的注释
// 🔄 OAuth token 提前10秒刷新，避免并发请求时过期
const REFRESH_THRESHOLD = 10000

// ❌ 避免的注释
// 设置变量为10000
const REFRESH_THRESHOLD = 10000
```

## 🏗️ 架构模式

### 目录结构规范
```
src/
├── services/     # 业务逻辑层，无状态服务
├── routes/       # 路由定义，薄控制层
├── middleware/   # 中间件，横切关注点
├── models/       # 数据访问层，Redis 抽象
├── utils/        # 纯函数工具，无副作用
└── app.js        # 应用入口和初始化
```

### 错误处理
- **统一错误格式**: 使用自定义 Error 类型
- **日志记录**: Winston 结构化日志，包含上下文信息
- **用户友好**: API 返回标准化错误响应

```javascript
// 标准错误处理模式
try {
  const result = await riskyOperation()
  logger.info('✅ Operation completed', { operation: 'tokenRefresh', accountId })
  return result
} catch (error) {
  logger.error('❌ Operation failed', { 
    error: error.message, 
    stack: error.stack,
    context: { accountId, operation: 'tokenRefresh' }
  })
  throw new ApiError('Token refresh failed', 500, error)
}
```

## 🔒 安全规范

### 数据保护
- **敏感数据**: 使用 AES-256 加密存储 (tokens, keys)
- **密码处理**: BCrypt 哈希，salt rounds >= 10
- **环境变量**: 所有密钥通过环境变量配置
- **日志安全**: 禁止记录敏感信息到日志文件

### 输入验证
- **参数检查**: 所有外部输入必须验证
- **类型安全**: 使用严格类型检查
- **注入防护**: 使用参数化查询，避免代码注入

## ⚡ 性能规范

### 异步编程
- **非阻塞IO**: 所有IO操作必须异步
- **并发控制**: 使用适当的并发限制
- **资源清理**: 及时释放连接和资源

### Redis 操作
- **连接复用**: 使用连接池，避免频繁连接
- **批量操作**: 使用 pipeline 减少网络往返
- **过期策略**: 设置合理的键过期时间

```javascript
// ✅ 正确的 Redis 操作
const pipeline = redis.pipeline()
pipeline.set(`key1`, value1, 'EX', 3600)
pipeline.set(`key2`, value2, 'EX', 3600)
await pipeline.exec()

// ❌ 避免的操作
await redis.set(`key1`, value1, 'EX', 3600)
await redis.set(`key2`, value2, 'EX', 3600)
```

## 🧪 测试规范

### 单元测试
- **测试框架**: Jest + SuperTest
- **覆盖率**: 核心业务逻辑 > 80%
- **Mock策略**: 外部依赖必须 mock

### 集成测试
- **API测试**: 完整请求链路测试
- **错误场景**: 异常情况覆盖
- **性能测试**: 关键接口响应时间验证

## 📋 提交规范

### Git 提交
- **消息格式**: `type: 简短描述` (中英文可)
- **类型标识**: feat/fix/docs/style/refactor/test/chore
- **原子提交**: 一个功能一个提交，避免混合修改

### 代码审查
- **自检清单**: 提交前运行 `npm run lint` 和 `npm test`
- **安全检查**: 确保无敏感信息泄露
- **性能影响**: 评估修改对系统性能的影响