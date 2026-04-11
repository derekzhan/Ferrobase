# Ferrobase 功能清单

> Rust + Tauri 2 现代数据库客户端 · 全功能版 · 对标 DBeaver 全版本能力合集

---

## 1. 数据库连接管理

### 1.1 连接创建与配置
- 图形化连接创建向导（分步引导）
- 基本参数配置：Host / Port / Database / Username / Password
- 自定义连接字符串 URL 直接输入
- 高级连接属性编辑（key-value 扩展参数）
- 连接测试（Test Connection）
- Bootstrap SQL：连接建立后自动执行的初始化查询（如 `SET search_path`、`USE db`）
- 连接克隆 / 复制
- 连接导入 / 导出（JSON / XML 格式）
- 连接颜色标签（7 色标识，在列表 / 编辑器 Tab 中同步显示）
- 连接超时配置（查询超时秒数、连接空闲超时）
- 只读连接模式（写操作自动拦截并提示）
- 连接池参数配置（最大连接数、空闲连接回收、连接寿命上限）
- 自动重连策略（断线重连间隔、最大重试次数、指数退避）
- 连接健康检查（心跳探测间隔、失败阈值自动标记断开）

### 1.2 连接组织
- 连接分组（文件夹树形结构，支持多级嵌套）
- 连接类型标签：Development / Test / Production，各类型独立颜色标识
- 自定义连接类型（名称、颜色、自动提交策略、事务隔离级别）
- 连接搜索 / 快速过滤
- 连接排序（按名称 / 类型 / 最近使用 / 手动排序）
- 连接收藏 / 置顶
- 连接标签（Tags）系统
- 最近使用连接列表（快速重连最近 N 个连接）
- 连接状态实时指示（已连接 / 已断开 / 连接中 / 错误，彩色状态图标）
- 连接拖拽排序 / 拖拽到分组

### 1.3 网络配置
- **SSH 隧道**
  - 用户名/密码认证
  - 公钥认证（RSA / DSA / ECDSA / Ed25519）
  - SSH Agent 认证（需先启动 agent）
  - 跳板机 / Jump Server（支持多级跳转链，如 localhost → 跳板A → 跳板B → 目标）
  - SSH 隧道共享（相同 SSH 配置的多个数据库连接自动复用同一隧道）
  - SSH 隧道浏览器（Window → Show View → SSH tunnel explorer，查看所有活动隧道及关联连接）
  - Keep-Alive 心跳间隔配置
  - 本地/远程端口转发配置
  - 测试隧道配置按钮
  - 网络配置模板（Network Profile）：可复用的 SSH 配置，多连接共享
  - 云 SSH 隧道（通过 Cloud Explorer 配置，集成云服务商认证）
- **SOCKS 代理**
  - SOCKS4 / SOCKS5 协议支持
  - 代理地址 / 端口 / 用户名 / 密码
- **SSL/TLS**
  - SSL 加密连接开关
  - 自定义 CA 证书 / 客户端证书 / 密钥文件
  - 信任库（Truststore）配置（可选择默认或自定义）
  - 证书验证模式选择（严格 / 宽松 / 忽略）
  - BouncyCastle 高级安全算法支持
- **HTTP 代理**
  - HTTP / HTTPS 代理支持
  - 代理地址 / 端口 / 用户名 / 密码
  - PAC 脚本自动代理配置
- **Shell 命令钩子**
  - Before Connect（连接前执行）
  - After Connect（连接后执行）
  - After Disconnect（断开后执行）

### 1.4 驱动管理器（Driver Manager）
- 预装 100+ 数据库驱动
- 首次连接自动下载所需驱动
- 自定义驱动：添加自定义 JDBC/ODBC 驱动文件
- 驱动属性编辑：连接 URL 模板、默认端口、驱动类名、驱动参数
- 多版本驱动共存与切换
- 驱动文件完整性校验（ZIP 档案额外验证）
- 驱动分类浏览（关系型 / 文档型 / 键值型 / 时序型 / 图 / 搜索引擎 / 消息队列）

### 1.5 支持的数据库类型
- **关系型**：MySQL, MariaDB, PostgreSQL, SQLite, Oracle, SQL Server, DB2, Firebird, H2, HSQLDB, Derby, Informix, Teradata, Exasol, Snowflake, Vertica, Presto/Trino, Greenplum, CockroachDB, SingleStore, TiDB, OceanBase, Redshift, Athena, ClickHouse, DuckDB, SAP HANA, Netezza, NuoDB, Phoenix, CUBRID, GaussDB, Kingbase, DM, LibSQL/Turso
- **NoSQL / 文档型**：MongoDB, Couchbase, CouchDB, Amazon DynamoDB, Google Firestore, Azure CosmosDB
- **键值型**：Redis
- **时序型**：InfluxDB, AWS Timestream
- **图数据库**：Neo4j, AWS Neptune
- **搜索引擎**：Elasticsearch, Apache Solr
- **消息队列**：Apache Kafka (KSQL)
- **宽列存储**：Apache Cassandra, Google Bigtable
- **CRM / SaaS**：Salesforce
- **文件数据源**：CSV, XLSX, JSON, XML, Parquet, TSV（可直接作为数据源查询，支持跨格式 JOIN）
- **通用**：任何具有 JDBC 或 ODBC 驱动的数据库
- **本地文件**：支持通过 File → Open 直接打开 DuckDB / MS Access 等文件型数据库

### 1.6 认证方式
- 用户名 / 密码（数据库原生认证）
- Kerberos 认证
- Active Directory 认证
- SAML SSO
- OKTA 集成
- Windows 认证（SQL Server）
- OS 原生密码存储（macOS Keychain / Windows Credential Manager / Linux Secret Service）
- Master Password 主密码加密存储（企业级加密）
- Secret Manager 集成（云密钥管理服务）
- AWS IAM 数据库认证（RDS / Aurora / Redshift Token 方式）
- GCP Cloud SQL IAM 认证
- Azure AD Token 认证
- OAuth2 / OIDC 自定义提供商
- 双因素认证 (2FA) 支持

---

## 2. SQL 编辑器

### 2.1 代码编辑
- SQL 语法高亮（根据关联数据库类型自动适配保留字、系统函数、语法规则）
- 智能自动补全（Ctrl+Space）
  - 数据库对象名（表、视图、列、索引、函数、存储过程）
  - SQL 关键字 / 命令
  - 表别名补全
  - JOIN 条件自动补全
  - USING 子句补全
  - INSERT 语句列名补全
  - SELECT INTO 补全
  - 子查询派生列补全
  - 嵌套查询补全
  - `SELECT * FROM table` 按 Ctrl+Space 展开为全部列名
  - 基于最近标识符的补全（Ctrl+Shift+Space）
  - Schema 限定名自动补全（`schema.table.column`）
- 三种补全引擎（可在 Preferences 中切换）
  - Semantic 语义引擎（推荐）：基于完整 SQL 结构和词法作用域的上下文感知补全
  - Basic 基础引擎：基于已加载的数据库元数据
  - Hippie 引擎：基于当前脚本文件内容的相似词匹配
- 语义分析 / 实时错误检测
  - 问题标记（Problem Markers）：内联显示错误描述
  - 错误注解 tooltip：悬停查看详细错误信息
  - Quick Fix（Ctrl+1）：错误修复建议
  - 语义错误样式可配置
  - 语义分析支持 CREATE / ALTER TABLE 查询
- SQL 格式化（Ctrl+Shift+F）
  - 可配置关键字大小写规则（UPPER / lower / Capitalize）
  - 可配置缩进风格（空格 / Tab，宽度可调）
  - 全局格式化设置（Window → Preferences → SQL Editor → Formatting）
  - 连接级别格式化设置（可覆盖全局）
  - 格式化选中片段 / 整个脚本
- 大小写转换
  - Ctrl+Shift+X：转大写
  - Ctrl+Shift+Y：转小写
- 全行复制/剪切：未选中文本时 Ctrl+C / Ctrl+X 操作整行
- SQL 模板 / 代码片段（预定义 + 自定义模板库）
- 变量支持
  - `${variable}` 格式变量
  - 内置变量：`${time}`、`${date}`、`${user}` 等
  - 多行变量支持
  - 变量值输入提示对话框
- Outline 视图：CREATE / ALTER TABLE 查询的结构大纲浏览器
- 大文件支持：超大 SQL 文件自动禁用语法验证以保证性能
- 同义词高亮与验证
- 伪列（Pseudo Column）高亮
- `$$` 块高亮（函数/存储过程定义块）
- 书签 / 折叠（Code Folding）
- 查找 / 替换（Ctrl+F / Ctrl+H，支持正则）
- 行号显示
- 括号匹配高亮
- 当前行高亮
- 拖拽文本
- 多光标编辑
- 智能缩进（自动缩进 SQL 块）
- 拖拽对象名到编辑器（从导航树拖拽表/列名插入）
- 参数化查询支持（`?` / `$1` / `:param` 占位符，执行时弹出参数输入对话框）
- SQL 注释切换（Ctrl+/ 行注释、Ctrl+Shift+/ 块注释）
- 列模式编辑（Alt+拖拽竖直选择，批量编辑列）
- 自动闭合括号 / 引号
- 彩虹括号（嵌套括号多色区分）
- SQL 差异对比视图（双列对比两段 SQL）
- 代码小地图（Minimap，右侧代码缩略滚动条）

### 2.2 SQL 执行
- 执行单条语句（Ctrl+Enter / Cmd+Enter）
- 执行整个脚本（Ctrl+Alt+X，逐条顺序执行）
- 执行选中片段
- 多结果集支持：多个查询结果在不同 Tab 中展示
- 结果 Tab 固定（Pin）和分离（Detach）到独立窗口
- 执行时间统计（每次执行显示耗时，统计结果中包含执行时间列）
- 只读模式保护：INSERT/DELETE/UPDATE/DROP/CREATE/ALTER 语句在只读模式下被阻止并提示警告
- 断开状态执行：支持在未连接状态下执行脚本，自动重连
- 后台异步执行
- 取消执行（中止正在运行的查询）
- 执行历史 / 查询管理器（Query Manager）：按时间排序查看所有历史查询，支持按时间列排序
- 执行结果状态栏：显示行数、耗时、状态信息（单查询和多查询执行均可见）
- DROP TABLE IF EXISTS 语句不存在表时显示警告而非错误
- 语句分隔符自动检测（`;` / `GO` / `$$` / 自定义）
- 执行前确认（危险语句 DROP / TRUNCATE / DELETE 无 WHERE 弹窗确认）
- 查询参数绑定面板（可视化设置 prepared statement 参数值）
- 多数据库同时执行（同一 SQL 在多个连接上并行执行并对比结果）
- 执行输出面板（DBMS_OUTPUT / RAISE NOTICE / PRINT 消息捕获）

### 2.3 执行计划（Explain Plan）
- 触发方式：Ctrl+Shift+E 或右键菜单 "Explain execution plan"
- 树形视图展示执行计划（结果 Tab 中展示）
- 节点详情面板（统计数据：行数、成本、时间、缓冲区等）
- 重新评估（Reevaluate）按钮
- 查看源 SQL 脚本（View Source）
- 图形化执行计划可视化（Graph View）：节点大小/颜色反映成本
- 执行计划对比（Compare Plans）：并排对比两次执行计划差异
- 执行计划历史：自动保存执行计划快照，查看同一查询历次变化
- EXPLAIN ANALYZE 实际执行统计（Actual vs Estimated 对比）
- 执行计划导出（JSON / Text / 图片）
- 索引命中提示：高亮计划中全表扫描节点，提示缺失索引

### 2.4 可视化查询构建器（Visual Query Builder）
- 拖拽式 SQL 查询构建（无需手写 SQL）
- 可视化表连接（JOIN）：拖拽列建立连接
- 可视化过滤条件（WHERE）：下拉选择操作符和值
- 可视化排序（ORDER BY）
- 可视化分组（GROUP BY）/ 聚合函数
- 可视化 HAVING 子句
- 可视化列选择（SELECT 列勾选）
- 可视化 DISTINCT
- 可视化 LIMIT / OFFSET
- 打开现有 SQL 查询进行可视化编辑（SQL → Visual 解析）
- 随时执行并查看结果
- SQL ↔ 可视化双向实时同步
- 分析复杂 SQL 查询的可视化结构

### 2.5 脚本管理
- 脚本文件夹分组管理（树形目录）
- 每个脚本可绑定 / 重新分配数据库连接
- 脚本导入 / 导出
- Git 集成：脚本版本控制与团队协作
- SQL Console（临时查询窗口）保存
- 最近打开的脚本列表
- 脚本搜索

### 2.6 AI 智能辅助
- AI 自动补全与代码生成（接入 OpenAI / Claude / GitHub Copilot 等）
- AI Chat 面板：发送错误信息获取解释和修复建议
- Quick Fix 集成 AI：悬停错误注解或 Ctrl+1 触发 AI 修复
- 自然语言转 SQL（Prompt → SQL）
- SQL 转自然语言解释
- SQL 优化建议
- MCP Server 支持：AI 工具可直接与数据库通信
- AI 上下文感知：自动携带当前表结构和数据库元数据作为 AI 上下文
- AI 数据分析：选中结果集后让 AI 分析数据趋势、异常值、统计摘要

### 2.7 SQL 调试框架
- 存储过程 / 函数逐行调试
- 断点设置（Breakpoints）：行断点 / 条件断点
- 单步执行（Step Over / Step Into / Step Out / Run to Cursor）
- 变量查看（Variables Watch）：局部变量 / 参数值实时查看
- 调用栈查看（Call Stack）
- 表达式求值（Evaluate Expression）
- 支持数据库：PostgreSQL (pgDebugger)、Oracle PL/SQL、MySQL（有限支持）

---

## 3. 数据查看器与编辑器

### 3.1 数据展示模式
- 网格视图（Grid View）：传统表格展示（默认）
- 纯文本视图：文本格式展示
- 图片视图：BLOB 数据以图片形式展示（gif / png / jpeg / bmp / webp）
- JSON 视图：格式化 JSON 数据（语法高亮 + 折叠）
- XML 视图：格式化 XML 数据
- HEX 视图：二进制数据十六进制查看
- 空间数据视图（GIS / Map）：在地图上展示几何数据
- 文档视图（Document View）：NoSQL 文档数据库专用树形文档浏览
- 集合视图（Collection View）：NoSQL 集合浏览
- 视图模式可切换 / 可自定义默认模式
- 多视图并排显示
- 表单视图（Record View）：选中行在侧面板以表单形式展示所有列，适合宽表
- 转置视图（Transpose）：行列互换显示（列名作为行标签）
- Markdown 表格预览：将结果集以 Markdown 表格格式预览
- 日历视图：日期字段以日历形式展示分布（按天/周/月聚合）

### 3.2 数据编辑
- 内联编辑（Inline Edit）：直接在网格中编辑单元格
- 专用编辑面板：大文本 / BLOB / JSON / XML 在独立编辑面板中编辑
- JSON 编辑器弹窗（可拖动、可缩放，支持 Text / JSON 格式化双模式，格式化 / 紧凑 / 复制 / ⌘S 快捷保存）
- 外部编辑器打开 BLOB 内容
- 行着色映射：根据列值自动着色显示行（尊重列的视觉顺序）
- 行着色规则编辑器（自定义条件 → 颜色映射规则）
- 布尔图标显示：布尔值以图标形式展示（可配置：true/false、1/0、YES/NO、图标）
- NULL 值特殊显示（可配置显示样式和颜色）
- 新增行 / 复制行 / 删除行
- 编辑状态标记（已修改的行/单元格高亮）
- 变更预览与确认（生成 SQL 预览）
- 保存变更 / 撤销变更（Revert）
- 批量编辑（多行同列批量修改）
- 日期格式化显示（可配置日期格式 + 时间戳插入/更新支持）
- 数组类型显示（UUID[]、IPv4[]、IPv6[]、Map 等以字符串形式展示）
- 外键导航：点击外键列值自动跳转到引用表对应行
- 虚拟外键（用户自定义关联关系，无需数据库实际外键约束）
- 单元格值设为 NULL 快捷操作（右键 → Set to NULL）
- 单元格值设为当前时间戳快捷操作
- 自增列自动跳过编辑（新增行时标识自增列灰色不可编辑）
- 粘贴数据自动创建新行（从 Excel / CSV 粘贴多行数据）
- 编辑回滚到上一次保存点（Undo stack 支持多步撤销）

### 3.3 数据过滤与排序
- 自定义过滤器（基于 SQL 表达式）
- WHERE 条件输入栏（数据 Tab 上方，支持自由输入 SQL WHERE 子句）
- 基于单元格值的快速过滤（右键 → Filter by value / Exclude value）
- 列头点击排序（升序 / 降序 / 取消）
- 多列组合排序
- 可滚动结果集 / 分页懒加载（大数据量渐进加载）
- 分页控制（每页行数可选 50 / 100 / 200 / 500，上下页翻页器）
- 过滤条件持久化（可保存/加载过滤配置）
- 过滤历史记录
- 列可见性控制（隐藏 / 显示特定列，列选择器面板）
- 列拖拽重排序（拖动列头调整显示顺序）
- 列宽自适应（双击列边界自动适应内容宽度）
- 列冻结 / 固定（冻结前 N 列，滚动时始终可见）
- 快速跳转到行号（Ctrl+G 输入行号定位）

### 3.4 数据操作
- 基于选中行生成 SQL（INSERT / UPDATE / DELETE 语句）
- 右键行菜单：Copy as INSERT / Copy as UPDATE / Copy as DELETE / Delete Row
- 基本统计：选中列自动显示 COUNT / SUM / AVG / MIN / MAX（底部统计栏）
- 高级复制（Advanced Copy）：自定义分隔符、引号、行格式、包含列名等
- 复制为多种格式：CSV / TSV / JSON / Markdown 表格 / HTML 表格 / SQL INSERT
- BLOB/CLOB 查看与编辑：十六进制 / 文本 / 图片 / 外部编辑器
- 数据导出（带当前过滤和排序条件）
- 单元格值类型信息查看
- 行计数显示
- 结果集缩放（Ctrl+Alt+0 / Ctrl+Alt+9）
- 结果集对比（Compare Results）：并排对比两次查询结果差异
- 结果集固定（Pin Results）：固定当前结果集，新查询打开新 Tab
- 结果集分离（Detach）：将结果拖出为独立窗口
- 全选 / 反选 / 按列选择
- 复制单元格值 / 复制列名 / 复制行（快捷键支持）

### 3.5 空间数据查看器（GIS / Spatial）
- 地图可视化显示空间几何数据（基于 Leaflet / MapLibre）
- 支持数据库：PostgreSQL (PostGIS)、MySQL、H2GIS、SpatiaLite、DuckDB (geometry) 等
- 多列颜色区分：每个表列在地图上有独立颜色标识
- 地图图层管理
  - 预定义多种瓦片图层（OpenStreetMap / Satellite 等）
  - 自定义 Leaflet 图层（L.tileLayer 参数配置）
  - 图层开关 / 叠加
- 点击查询：点击地图对象显示详细属性信息
- 坐标复制：右键任意地图点复制坐标（EPSG:4326 格式，纬度,经度）
- 格式转换：字符串 / 二进制列可转换为 Geometry 格式显示（通过 View/Format 设置）
- 缩放 / 平移 / 全屏 / 定位到数据范围

---

## 4. 元数据浏览器（Database Navigator）

### 4.1 导航树结构
- 数据库连接（Connections）
  - 数据库 / Catalog / Schema
    - 表（Tables）
      - 列（Columns）：名称、类型、长度、精度、默认值、是否可空、注释
      - 索引（Indexes）：类型、包含列、唯一性、排序方向
      - 约束（Constraints）：主键、唯一约束、检查约束、非空约束
      - 外键（Foreign Keys）：引用表/列、级联规则
      - 触发器（Triggers）：事件类型、触发时机、触发体
      - 分区（Partitions）：分区类型、分区键、子分区
      - 策略（Policies）：行级安全策略（RLS）、关联角色
    - 视图（Views）：定义查询、是否可更新
    - 物化视图（Materialized Views）：刷新状态、最后刷新时间
    - 存储过程（Procedures）：参数列表、返回类型
    - 函数（Functions）：参数列表、返回类型
    - 包（Packages）：包头、包体（Oracle）
    - 序列（Sequences）：当前值、增量、范围
    - 自定义类型（Types / Domains）
    - 同义词（Synonyms）
    - 扩展（Extensions）：PostgreSQL 扩展管理
  - 存储实体：表空间（Tablespaces）
  - 安全实体：用户（Users）、角色（Roles）、权限（Privileges）
  - 链接服务器（Linked Servers）：SQL Server

### 4.2 元数据操作
- 查看 DDL：显示任意数据库对象的 DDL 定义语句
- 生成标准 DDL：根据对象结构生成 SQL92 标准 DDL
- 创建数据库对象（Create Table / View / Index / Sequence 等向导）
- 编辑 / 重命名 / 删除数据库对象
- 全局过滤：按名称模式过滤数据库对象
- 局部过滤：当前节点下按名称过滤
- 显示/隐藏视图控制（可配置是否在表列表中显示视图）
- 编译存储过程 / 函数 / 包（Oracle 等，从 UI 直接编译）
- 截断表（Truncate Table）
- Drop Table / Drop View（右键上下文菜单，带确认对话框）
- 刷新物化视图（Refresh Materialized View）
- 对象状态显示（Valid / Invalid / Enabled / Disabled）
- 对象属性面板（Properties Panel）：多 Tab 显示对象各维度信息
  - Data（数据预览 + 内联编辑）
  - Columns（列详情：名称、类型、是否可空、键类型、自增、默认值、Extra、注释）
  - Indexes（索引名、列、类型、唯一性、是否主键）
  - DDL（CREATE 语句，语法高亮）
- 对象依赖关系查看（依赖图 / 被依赖列表）
- 对象权限查看与编辑
- 快速打开 SQL 编辑器（右键 → SQL Editor → New SQL Script）
- 快速打开数据查看器（双击表 / Enter）
- 对象刷新（F5）：刷新元数据缓存
- 复制对象名称到剪贴板
- 对象比较（选中多个对象右键比较）
- 右键上下文菜单（DBeaver 风格，全对象覆盖）
  - 连接级：Edit Properties / Disconnect / Clone Connection / Create Database / Drop Database
  - 数据库级：Create Table / Create View / Refresh / SQL Editor
  - 表级：Open Data / Open SQL / Generate SQL (INSERT/UPDATE/DELETE) / Truncate / Drop / Copy Name / Add Column / Add Index
  - 视图级：Open Data / View DDL / Drop View
- 添加列向导（对话框：列名 / 类型 / 默认值 / 是否可空 / 注释 / 位置选择）
- 添加索引向导（对话框：索引名 / 列选择 / 唯一性 / 索引类型）

### 4.3 数据类型图标系统
- 每种数据类型有独立图标（VARCHAR / INT / BOOLEAN / DATE / BLOB / JSON / GEOMETRY 等）
- 主键列 / 外键列特殊图标标识
- 索引列标识
- 非空列标识
- 虚拟列 / 计算列标识

---

## 5. ER 图（Entity-Relationship Diagrams）

### 5.1 自动生成
- 数据库 / Schema 级别：自动生成包含所有表的 ER 图
- 单表级别：自动生成包含所有引用 / 被引用表的 ER 图
- 选中多表生成局部 ER 图

### 5.2 图表功能
- 自定义列可见性（控制每个表显示哪些列）
- 表的拖拽自由布局
- 自动布局算法（层次布局 / 力导向布局 / 正交布局）
- 缩放 / 平移 / 适应窗口（Fit to Window）
- 小地图（Minimap）导航
- 关系线显示（外键关系，直线 / 折线可切换）
- 关系基数标注（1:1 / 1:N / N:N）
- 表颜色 / 样式自定义
- 注释（Annotation / Note）添加

### 5.3 导出
- PNG / SVG / PDF / BMP / GIF 导出
- GraphML 导出（可在 yEd 等工具中编辑）
- 打印支持

### 5.4 自定义图表
- 手动创建空白 ER 图
- 从导航树拖拽表到图表
- 保存 / 加载自定义图表
- 图表收藏

### 5.5 Forward Engineering
- 从 ER 图直接创建 / 修改表结构
- 从 ER 图生成 DDL 脚本
- 可视化添加 / 修改列、关系、约束

---

## 6. 数据导入 / 导出 / 迁移

### 6.1 数据导出
- 导出目标：文件 / 另一个数据库表 / 剪贴板
- 支持格式：CSV, TSV, JSON, XML, HTML, SQL (INSERT 语句), XLS, XLSX, Markdown, Parquet, YAML
- 导出触发入口：结果面板工具栏按钮 / 右键菜单 / 文件菜单
- 自动建表：导出到数据库时可自动创建目标表（如果不存在）
- 保留过滤：导出时保留当前应用的过滤和排序条件
- 列选择：可选择导出哪些列
- 导出配置
  - 分隔符（逗号 / Tab / 分号 / 自定义）
  - 引号字符 / 转义字符
  - 编码（UTF-8 / GBK / ISO-8859-1 等）
  - 日期格式
  - NULL 值表示（空字符串 / "NULL" / 自定义）
  - 是否包含列头
  - 行数限制
- 批量导出：多表同时导出（可选择不同格式）
- 导出进度显示 / 取消

### 6.2 数据导入
- 从 CSV / TSV / JSON / XML / XLSX 文件导入到数据库表
- 列映射配置向导：源列 ↔ 目标列映射（拖拽映射）
- 数据类型配置 / 类型转换
- 数据预览（导入前预览前 N 行）
- 错误处理策略（跳过错误行 / 停止导入 / 记录日志继续）
- 批量大小配置（Batch Size）
- 导入进度显示 / 取消

### 6.3 任务保存与调度
- 保存数据传输配置为可复用任务（一键执行）
- 定时执行 / 周期性执行
  - cron 表达式
  - Windows Task Scheduler
  - 命令行触发
- 任务执行日志与状态追踪
- 邮件通知：任务完成 / 失败后发送邮件报告
- 复合任务：多步骤任务编排（如先备份再导出再通知）

### 6.4 数据迁移
- 跨数据库数据迁移（如 MySQL → PostgreSQL）
- 表结构 + 数据同步迁移
- 数据类型自动映射 / 手动映射配置
- 迁移预览 / 试运行（Dry Run）
- 迁移日志

---

## 7. 数据库管理与运维

### 7.1 事务管理
- 自动提交模式（Auto Commit）
- 手动提交模式（Manual Commit / Rollback）
- 事务日志：查看当前会话的所有事务操作记录
- 待处理事务查看（Pending Transactions）
- 事务隔离级别配置（Read Uncommitted / Read Committed / Repeatable Read / Serializable）
- 每连接独立事务设置
- 事务设置可在连接编辑器中配置

### 7.2 会话管理
- 查看当前数据库服务器的活动会话列表
- 会话详情：SQL 查询文本、执行时间、状态、客户端 IP、应用名称
- 查询进度监控
- 终止会话（Kill Session）
- 终止查询（Kill Query）
- 自动刷新（可配置刷新间隔）
- 会话过滤

### 7.3 锁管理
- 查看当前数据库的事务锁列表
- 锁类型显示（行锁 / 表锁 / 页锁 / 意向锁等）
- 锁冲突分析（锁等待链 / 死锁检测）
- 解锁操作
- 锁持有者信息（会话 / 查询 / 对象）

### 7.4 数据库备份与恢复
- 支持数据库原生备份工具集成
  - PostgreSQL：pg_dump / pg_restore / Complete Backup
  - MySQL：mysqldump / mysqlpump
  - Oracle：expdp / impdp
  - SQL Server：BACKUP / RESTORE
- 可视化配置备份参数（格式 / 压缩 / 并行度 / 包含对象选择）
- 完整备份 / 部分备份（选择表/Schema）
- 恢复向导
- 备份历史记录
- 备份文件管理

### 7.5 数据库仪表盘（Dashboards）
- 实时服务器监控仪表盘
- 内置指标
  - 服务器负载（CPU / 内存 / IO）
  - 连接数（活动 / 空闲 / 总数）
  - 查询性能（QPS / TPS / 慢查询数）
  - 活动查询列表
  - 缓存命中率
  - 复制延迟（主从复制）
  - 存储空间使用
  - 表大小排行（Top N 最大表）
  - 索引命中率
  - 临时表 / 临时文件使用
- 自定义监控图表（自定义 SQL 查询作为数据源）
- 图表类型：折线图 / 柱状图 / 仪表盘 / 饼图 / 面积图 / 热力图
- 自动刷新间隔配置
- 仪表盘布局自定义（拖拽排列）
- 仪表盘保存 / 加载 / 分享
- 告警规则（阈值触发桌面通知 / 邮件 / Webhook）

### 7.6 用户与权限管理
- 用户列表查看与管理
- 角色列表查看与管理
- 权限矩阵视图
- 授权 / 撤权操作
- 用户创建 / 删除 / 修改

---

## 8. 搜索功能

### 8.1 全文数据搜索
- 在选定的表 / 视图中进行全文搜索
- 搜索结果以过滤后的表 / 视图形式展示
- 多表同时搜索
- 正则表达式搜索
- 大小写敏感 / 不敏感切换
- 搜索结果高亮

### 8.2 元数据搜索
- 在数据库系统表中搜索元数据
- 支持精确名称或通配符搜索模式
- 跨 Schema / 跨数据库搜索
- 搜索对象类型过滤（只搜表 / 只搜视图 / 只搜列 等）

### 8.3 文件搜索
- 在项目文件中搜索 SQL 脚本内容
- 文件名搜索
- 文件内容全文搜索
- 正则表达式支持

### 8.4 全局快速搜索
- 全局搜索框（Ctrl+Shift+P 风格，类似 Spotlight / Command Palette）
- 同时搜索连接、对象、脚本、设置、命令
- 模糊匹配
- 最近搜索历史

---

## 9. 结构对比与同步

### 9.1 Schema 对比
- 比较对象类型：表、视图、存储过程、Schema、整个数据库
- 跨数据库实例对比（如 开发环境 vs 生产环境）
- 同数据库对比（同一数据库内不同 Schema / 不同对象）
- 对比维度：列（名称 / 类型 / 默认值 / 可空）、索引、约束、触发器、权限

### 9.2 对比结果输出
- HTML 报告（可分享的静态页面）
- DDL ALTER 脚本（自动生成变更 SQL，可直接执行）
- Diff 图表（可视化左右对比）
- Liquibase Changesets（XML / YAML / JSON 格式）

### 9.3 数据对比
- 比较两个表的实际数据内容差异
- 差异行高亮（新增 / 删除 / 修改）
- 生成同步 SQL（INSERT / UPDATE / DELETE）
- 主键 / 唯一键匹配配置

### 9.4 结构同步
- 基于对比结果执行数据库结构同步
- 预览同步脚本（执行前确认）
- 选择性同步（勾选要同步的变更项）
- 正向同步 / 反向同步

---

## 10. Mock 数据生成器

### 10.1 基本生成器
- 数字（Numbers）：随机整数 / 浮点数，范围 / 精度可配
- 随机字符串（Random Strings）：长度 / 字符集 / 前缀后缀可配
- 日期/时间（Date/Time）：范围可配，格式可选
- 布尔值（Boolean）：真/假比例可配
- UUID
- NULL 值（按比例生成 NULL）
- 枚举值（从预定义列表中随机选择）
- 自增序列

### 10.2 高级生成器
- 姓名（Names）：名 / 姓 / 全名，支持多语言 / 地区
- 地址（Addresses）：街道 / 城市 / 州省 / 邮编 / 国家
- 电子邮件（Emails）：真实格式邮箱
- 电话号码（Phone Numbers）：支持多国号码格式
- 信用卡号（Credit Cards）：符合 Luhn 算法
- 域名和 IP 地址（Domains & IPv4 / IPv6）
- 自定义正则表达式（Custom RegExp）：按正则模式生成
- 灵活数字生成器（序列 / 正态分布 / 均匀分布 / 指数分布）
- 公司名（Company Names）
- 文本段落（Lorem Ipsum / 可配置长度）
- URL 地址
- 颜色值（HEX / RGB）
- 坐标（经纬度）

### 10.3 生成配置
- 生成行数配置
- 多表同时生成（自动处理外键依赖关系，按拓扑顺序生成）
- 预览生成数据
- 直接插入数据库 / 导出为文件（SQL / CSV）
- 生成种子（Seed）：可复现生成结果
- 唯一值约束处理

---

## 11. 项目与工作区管理

### 11.1 项目系统
- 多项目支持：每个项目有独立的连接配置和脚本文件
- 项目切换
- 项目导入 / 导出（归档 / 解档）
- 项目安全 / 访问控制

### 11.2 书签系统
- 保存常用数据库对象为书签
- 书签分组 / 文件夹管理
- 快速跳转到书签对象
- 书签同步

### 11.3 任务系统
- 复合任务（多步骤任务编排）
- 任务类型：数据导出 / 导入 / 备份 / SQL 脚本执行 / 通知
- 任务调度器（定时 / cron / 命令行触发）
- 任务执行日志 / 状态 / 历史
- 任务依赖（前置任务完成后触发）

### 11.4 Git 集成
- SQL 脚本版本控制（commit / push / pull / diff / blame）
- 分支管理（branch / merge / checkout）
- 冲突解决
- Git 状态指示（文件修改 / 新增 / 删除标记）
- .gitignore 支持

---

## 12. 安全特性

### 12.1 凭据存储
- Master Password：主密码保护的加密凭据库
- OS 原生密码存储集成（Keychain / Credential Manager / Secret Service）
- 凭据永不以明文存储
- 加密算法可配置

### 12.2 企业级认证
- Kerberos 认证集成
- Active Directory 认证
- SAML SSO
- OKTA 集成
- 自定义 OAuth2 / OIDC

### 12.3 连接安全
- SSL/TLS 加密传输
- SSH 隧道加密
- SOCKS 代理
- 驱动文件完整性校验（下载后验证）
- 信任库管理（证书导入/导出/查看）
- BouncyCastle 高级安全算法

### 12.4 数据安全
- 敏感数据脱敏显示（可配置脱敏规则）
- 操作审计日志
- 只读连接模式

---

## 13. 设置与配置

### 13.1 全局首选项（Preferences）
- **外观**
  - 主题（明 / 暗 / 跟随系统）
  - 编辑器字体族（JetBrains Mono / Fira Code / Cascadia Code / Source Code Pro / 系统字体）
  - 编辑器字号（10 ~ 20px，滑块调节）
  - 编辑器行高
  - UI 整体缩放比例
- **SQL 编辑器**
  - 补全引擎选择
  - 格式化规则
  - 语法高亮颜色方案
  - 自动保存
  - 粘贴自动格式化（开关）
  - 代码小地图显示（开关）
  - 括号自动闭合
  - Tab 缩进宽度
- **数据编辑器**
  - NULL 值显示样式（NULL / (null) / — / 空白）
  - 布尔值显示样式（true/false / 1/0 / YES/NO / 图标）
  - 日期/时间格式（ISO / 本地化 / 自定义 strftime）
  - 小数精度位数（0 ~ 20）
  - 默认每页行数（50 / 100 / 200 / 500）
  - 大文本截断长度
  - BLOB 显示策略（HEX / Base64 / 大小信息）
- **连接**
  - 默认查询超时秒数（5 ~ 3600s）
  - 默认行数限制（100 ~ 10000）
  - 默认连接参数模板
  - 自动断开策略（编辑器关闭时断开 / 空闲超时断开）
  - 重连策略（自动重连 / 手动重连）
- **工具栏自定义**：添加/移除/排列工具栏按钮
- **快捷键自定义**：全局快捷键映射编辑器
- **导航树**：显示/隐藏对象类型、排序规则、图标风格
- **查询管理器**：历史记录保留数量（最大 500 条）、自动清理策略
- **隐私与安全**
  - 遥测数据收集（开关）
  - 崩溃报告自动发送（开关）
  - 查询历史保留策略

### 13.2 连接级别设置
- 每连接独立 SQL 格式化设置（可覆盖全局）
- 每连接独立事务策略
- 每连接独立字符编码
- 连接名称和背景色在编辑器切换器（Ctrl+E）中显示

### 13.3 设置存储
- 所有设置存储在用户数据目录（DBeaverData / FerrobaseData）
- 卸载 / 重装不丢失设置
- 升级时自动保留配置
- 设置导入 / 导出（便于迁移或团队统一配置）
- 设置重置为默认值

---

## 14. 用户界面

### 14.1 主界面布局
- **左侧导航栏**：数据库导航树（Database Navigator）+ 项目浏览器（Project Explorer）
- **中央编辑区**：SQL 编辑器 / 数据查看器 / ER 图 / 仪表盘（多 Tab）
- **下方面板**：查询结果 / 执行计划 / 执行日志 / 输出 / 统计 / 消息 / 历史记录
- **右侧属性面板**：对象属性 / DDL 查看 / 数据预览
- **工具栏**：可自定义的操作按钮栏
- **状态栏**：活动连接数、最近查询统计（行数 / 耗时）、当前数据库类型图标
- **欢迎页面**：首次启动引导、快捷操作入口、最近连接列表

### 14.2 面板系统
- 面板拖拽自由布局（上下左右任意停靠）
- 面板折叠 / 展开 / 浮动 / 最大化
- 布局保存 / 加载 / 重置为默认
- 多窗口支持（拖出为独立窗口）
- 面板快速切换菜单（Window → Show View）

### 14.3 多 Tab 支持
- 多个 SQL 编辑器 Tab 并行编辑
- 多个表查看器 Tab 并行浏览
- 结果 Tab 固定（Pin）和分离（Detach）到独立窗口
- 编辑器切换器（Ctrl+E）：下拉列表显示所有打开的编辑器，含连接名和背景色
- Tab 右键菜单（关闭 / 关闭其他 / 关闭所有 / 关闭右侧 / 关闭已保存的）
- 编辑器关闭时自动断开连接（可配置）
- Tab 拖拽排序
- 分屏编辑（水平 / 垂直分屏）
- Tab 类型图标区分（SQL 图标 / 表图标 / 不同颜色标识不同连接）
- Tab 名称显示连接名和数据库名（hover tooltip 显示完整路径）

### 14.4 主题系统
- 亮色主题 / 暗色主题 / 跟随系统（自动检测 OS 设置）
- 语法高亮颜色完全自定义
- 字体 / 字号全局配置（支持 JetBrains Mono / Fira Code / Cascadia Code / Source Code Pro / 系统字体）
- 自定义主题导入 / 导出
- 主题实时预览（切换即时生效，无需重启）
- CSS 变量体系（支持第三方主题扩展）

### 14.5 快捷键系统
- 全局快捷键自定义配置
- 快捷键冲突检测
- 预设快捷键方案（DBeaver / DataGrip / VS Code 风格可选）
- 快捷键速查表（Help → Key Assist / Ctrl+Shift+L）
- macOS 适配（Cmd 键映射，Cmd+Enter 执行）
- 核心快捷键
  - `Ctrl+Enter` / `Cmd+Enter`：执行当前 SQL
  - `Ctrl+Alt+X`：执行整个脚本
  - `Ctrl+Space`：自动补全
  - `Ctrl+Shift+F`：SQL 格式化
  - `Ctrl+Shift+E`：查看执行计划
  - `Ctrl+Shift+X`：转大写
  - `Ctrl+Shift+Y`：转小写
  - `Ctrl+Shift+Space`：基于最近标识符补全
  - `Ctrl+1`：Quick Fix
  - `Ctrl+E`：编辑器切换
  - `Ctrl+F` / `Ctrl+H`：查找 / 替换
  - `F5`：刷新元数据
  - `Ctrl+Alt+0` / `Ctrl+Alt+9`：结果集缩放

### 14.6 命令面板与全局操作
- 命令面板（Ctrl+Shift+P / Cmd+Shift+P）：全局快速操作入口
  - 搜索并执行任意命令
  - 快速打开连接 / 表 / 脚本
  - 快速切换主题
  - 快速切换语言
- 通知中心
  - 操作成功 / 失败通知（Toast 弹窗）
  - 后台任务进度通知
  - 连接状态变更通知
  - 通知历史查看
- 面包屑导航（Breadcrumb）：当前位置路径（连接 > 数据库 > Schema > 表），可点击跳转

### 14.7 国际化
- 多语言支持（中文 / 英文 / 日文 / 韩文 / 德文 / 法文等）
- 语言切换无需重启
- 日期 / 数字 / 货币格式本地化

---

## 15. 云集成

### 15.1 Cloud Explorer
- 统一云服务浏览器（树形结构浏览云资源）
- 同时连接 AWS / GCP / Azure / 本地数据库
- 跨环境可视化与控制（多云 + 多地域统一管理）
- 云数据库自动发现（从云账户自动列出 RDS / Cloud SQL / Azure SQL 等实例）
- 云 SSH 隧道配置（集成云服务商认证的 SSH 隧道）
- 中央身份认证（云 IAM / Service Account 认证）
- 自动连接配置（选中云数据库实例自动填充连接参数）

### 15.2 云存储管理
- AWS S3：存储桶浏览 / 文件上传 / 下载 / 删除
- Google Cloud Storage：同上
- Azure Blob Storage：同上
- 本地文件通过文件选择器访问
- 云存储文件直接作为数据源查询（CSV / Parquet / JSON from S3 等）

### 15.3 云安全
- SSO 认证保护数据库连接
- Secret Manager 集成（AWS Secrets Manager / GCP Secret Manager / Azure Key Vault）
- Master Password 加密保护所有云连接
- IAM 数据库认证（无需密码，使用 IAM 角色连接）

---

## 16. 特定数据库增强

> 针对主流数据库提供超出通用功能的专属增强

### PostgreSQL
- 存储过程调试（pgDebugger 集成）
- Complete Backup / pg_dump / pg_restore 集成
- 行级安全策略（RLS）查看与管理
- 物化视图刷新
- 扩展（Extensions）管理与安装
- 发布/订阅（Publication / Subscription）管理
- 逻辑复制状态查看

### MySQL / MariaDB
- mysqldump / mysqlpump 备份集成
- ER 图外键完整支持
- 用户权限管理（GRANT / REVOKE 向导）
- 零日期处理修复
- 字符集与排序规则管理

### Oracle
- PL/SQL 调试
- Procedure / Function / Package 编译（从 UI 直接编译）
- 对象状态显示（Valid / Invalid）
- 表空间管理
- AWR / ASH 报告集成
- Explain Plan 增强（Oracle 专属统计）

### SQL Server
- Windows 认证支持
- 链接服务器（Linked Servers）管理
- SQL Agent 作业查看
- 执行计划增强（XML Plan 解析）

### SQLite
- 文件直接打开（File → Open）
- 外键创建修复
- WAL 模式管理

### DuckDB
- 文件直接打开
- Geometry 类型显示支持
- Parquet / CSV 直接查询

### MongoDB
- 文档视图（JSON Tree View）
- 集合浏览与管理
- 集合文档查询（支持 `db.collection.find({filter}).limit(n).skip(m)` shell 语法）
- 文档 CRUD（插入 / 更新 / 删除，支持 JSON 编辑器）
- 聚合管道构建器（可视化构建 `$match` / `$group` / `$sort` / `$project` 等阶段）
- 索引管理（查看 / 创建 / 删除索引）
- 原生数据类型完整支持（ObjectId / Date / Binary / Decimal128 等）
- 多数据库浏览（自动列出所有数据库及其集合）
- 文档结构自动推断（自动发现所有字段作为列名）
- 数据预览分页（可配置每页文档数）

### Redis
- 键浏览器（Key Browser，带类型角标和 TTL 显示）
- 数据类型识别与展示（String / Hash / List / Set / ZSet / Stream）
- 键值查看与编辑（支持所有数据类型的值查看和修改）
- TTL 管理 / 过期时间设置
- 键模式搜索（`*pattern*` 通配符）
- 键删除（单个 / 批量）
- 原始命令执行器（直接执行 Redis CLI 命令）
- 服务器信息查看（`INFO` 命令输出，含内存、客户端、统计等）
- 内存使用分析
- 多数据库切换（DB 0 ~ 15）
- 键数量统计

### Apache Cassandra
- Keyspace 管理
- CQL 编辑器适配
- 一致性级别配置
- 原生集合类型支持

### InfluxDB
- 时序数据可视化
- InfluxQL / Flux 查询支持
- Retention Policy 管理
- 连续查询管理

### Elasticsearch
- 索引浏览与管理
- 映射（Mapping）查看
- 查询 DSL 编辑器
- 聚合结果可视化

### Kafka (KSQL)
- Topic 浏览
- KSQL 流查询
- Consumer Group 管理

### Salesforce
- SOQL 编辑器
- 对象（Object）浏览
- 货币数据类型支持

### 其他已验证数据库
- CUBRID：Schema 所有者变更支持
- GaussDB：M-Compatibility 数据库连接修复
- InterSystems IRIS：驱动集成
- Redshift：Schema 切换修复
- Athena：AWS Athena JDBC 驱动支持
- ClickHouse：参数处理修复
- SingleStore：编码支持修复

---

## 17. 性能分析与优化工具

### 17.1 查询性能分析
- 慢查询日志查看器（MySQL slow_query_log / PostgreSQL pg_stat_statements）
- 查询执行时间统计与排行（Top N 慢查询）
- 查询频率统计（最常执行的查询）
- 查询计划缓存查看
- 全表扫描检测与告警
- 未使用索引检测

### 17.2 索引分析与建议
- 索引使用率统计（命中次数 / 扫描次数）
- 冗余索引检测（完全包含或重复的索引）
- 缺失索引建议（基于查询计划和表扫描统计）
- 索引碎片率分析与重建建议
- 索引大小统计

### 17.3 表统计与健康检查
- 表大小排行（数据 / 索引 / 总计）
- 行数估算与精确统计
- 表碎片率分析
- 自增列溢出风险检测（当前值 / 最大值比例）
- 空表检测
- 超大表告警

### 17.4 数据分析与画像（Data Profiling）
- 列值分布统计（直方图 / 饼图）
- NULL 比例分析
- 唯一值计数（Cardinality）
- 最大值 / 最小值 / 平均值 / 中位数
- 常见值 Top N
- 数据格式模式检测（邮箱、手机号、日期格式等）
- 异常值检测（离群点分析）

---

## 18. 数据可视化与图表

### 18.1 结果集可视化
- 从查询结果一键生成图表
- 支持图表类型
  - 柱状图（垂直 / 水平）
  - 折线图 / 面积图
  - 饼图 / 环形图
  - 散点图
  - 热力图
  - 树状图（Treemap）
  - 雷达图
  - 漏斗图
  - 桑基图
- 轴映射配置（X 轴 / Y 轴 / 系列 / 颜色 / 大小映射）
- 图表交互（悬停 tooltip / 点击钻取 / 缩放 / 平移）
- 图表导出（PNG / SVG / PDF）

### 18.2 数据透视表（Pivot Table）
- 拖拽字段到行 / 列 / 值 / 过滤区域
- 聚合函数选择（SUM / COUNT / AVG / MIN / MAX / DISTINCT COUNT）
- 小计 / 总计显示
- 展开 / 折叠层级
- 透视表导出

### 18.3 交叉表报表
- 自定义交叉表布局
- 条件格式（颜色标度 / 数据条 / 图标集）
- 报表保存与分享

---

## 19. 插件与扩展系统

### 19.1 插件架构
- 插件加载机制（热加载 / 热卸载）
- 插件 API（扩展导航树 / 编辑器 / 面板 / 菜单）
- 插件沙箱隔离（防止插件影响主进程稳定性）
- 插件依赖管理

### 19.2 插件市场
- 在线插件市场浏览 / 搜索
- 一键安装 / 更新 / 卸载
- 插件评分 / 评论
- 官方插件 / 社区插件分类
- 私有插件仓库（企业内部分发）

### 19.3 内置可扩展点
- 自定义数据库驱动插件
- 自定义数据导出格式插件
- 自定义数据类型渲染器插件
- 自定义面板 / 视图插件
- 自定义主题插件
- 自定义 AI Provider 插件

---

## 20. 命令行与自动化

### 20.1 CLI 模式
- 无头模式执行 SQL 脚本（`ferrobase exec --connection <name> --file script.sql`）
- 命令行数据导出（`ferrobase export --format csv --table users --output users.csv`）
- 命令行数据导入（`ferrobase import --format csv --table users --file data.csv`）
- 命令行连接测试（`ferrobase test --connection <name>`）
- 退出码支持（0 成功 / 非 0 失败，适配 CI/CD 流水线）
- JSON 输出模式（`--output-format json`，便于脚本解析）

### 20.2 自动化脚本支持
- JavaScript / TypeScript 脚本引擎（在编辑器中编写和运行自动化脚本）
- 脚本 API：连接管理 / 查询执行 / 结果处理 / 文件 IO
- 定时任务集成（结合 Section 6.3 任务调度）
- Webhook 触发器（HTTP POST 触发预定义任务）

### 20.3 REST API Server
- 内置可选 REST API 服务器
- 通过 HTTP 暴露查询接口（带认证）
- API 文档自动生成（OpenAPI / Swagger）
- 用于集成 BI 工具、报表系统等外部系统

---

## 21. 协作与团队功能

### 21.1 连接共享
- 连接配置导出为加密文件（便于团队分发）
- 团队连接模板（管理员预配置，成员只需填密码）
- 连接配置同步（通过 Git / 云存储 / 企业服务器）

### 21.2 查询共享
- SQL 片段分享（生成分享链接 / 二维码）
- 团队查询库（共享常用查询集合）
- 查询注释与标注

### 21.3 操作审计
- 所有 DDL/DML 操作日志记录
- 审计日志导出（CSV / JSON）
- 审计日志过滤（按用户 / 连接 / 时间 / 操作类型）
- 敏感操作审批流程（DROP / TRUNCATE 需审批后执行）

---

## 22. 跨平台与系统集成

### 22.1 跨平台支持
- macOS（Apple Silicon M1/M2/M3/M4 + Intel 通用二进制）
- Windows（x64 + ARM64）
- Linux（AppImage / .deb / .rpm / Flatpak / Snap）
- 各平台原生窗口行为（标题栏、菜单栏、快捷键映射）

### 22.2 系统集成
- 系统托盘驻留（最小化到托盘，保持连接）
- 文件关联（双击 .sql / .sqlite / .duckdb 文件直接打开）
- 深色/浅色模式跟随系统（macOS / Windows / Linux）
- 原生通知（系统通知中心推送）
- macOS Dock 图标角标（显示活动连接数）
- 深度链接协议（`ferrobase://connect?host=...` URL 快速连接）
- Spotlight / Alfred / Wox 集成（快速搜索连接和对象）

### 22.3 应用更新
- 自动更新检测（启动时检查新版本）
- 应用内更新（下载并安装，无需手动操作）
- 更新日志查看（Changelog）
- 更新频道选择（Stable / Beta / Nightly）
- 离线更新包安装

### 22.4 日志与诊断
- 应用日志查看器（Help → View Log）
- 日志级别配置（Error / Warn / Info / Debug / Trace）
- 崩溃报告自动收集（匿名化）
- 性能指标采集（内存 / CPU / 启动时间）
- 诊断信息导出（Support Bundle，一键导出环境信息）

---

## 23. 无障碍与可用性（Accessibility）

### 23.1 键盘可用性
- 全功能键盘导航（Tab / Shift+Tab / Arrow keys / Enter / Escape）
- 焦点指示器（高对比度焦点环）
- 快捷键速查表（Help → Keyboard Shortcuts）
- 上下文敏感快捷键提示（菜单项右侧显示快捷键）

### 23.2 屏幕阅读器
- ARIA 标签（所有交互元素均有语义标注）
- 屏幕阅读器兼容（VoiceOver / NVDA / JAWS）
- 表格结构语义化（行列标题正确标注）

### 23.3 视觉辅助
- 高对比度主题
- 字号缩放（全局缩放 75% ~ 200%）
- 色弱模式（红绿色弱友好调色板）
- 动画减弱模式（Reduce Motion 跟随系统设置）
