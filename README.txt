成都饭搭子：Render 短期部署版

本包保留原投票网页，使用 Node.js + PostgreSQL 保存跨用户共享的票数和记录。
包含75家去重店铺与原截图裁剪封面、分类和搜索、路线距离、预计驾车时间、点评入口、昵称单选、改票、分页记录。
截图明确的分店按截图定位；未写分店的品牌在已查询同名门店中按驾车距离选择最近门店。
已核对74家驾车路线；徐孃钵钵鸡未匹配同名地图门店，页面明确标注位置与距离待核实。
滋味烤鱼使用点评门店直链，其余74家使用点评店名搜索入口。

部署
1. 将本目录源码放到可由 Render 访问的 Git 仓库。
2. 使用 render.yaml 创建 Blueprint。文件仅声明免费 Web Service 和免费 Postgres。
3. 若账号已使用唯一一个免费数据库，请先确认是否复用现有数据库；不要删除用户现有数据库。
4. DATABASE_URL 由 Blueprint 从数据库内部连接地址注入，不在源码中保存密码。
5. 服务启动后访问首页、/healthz 和 /api/poll，随后用真实微信验证访问与投票。

手动部署的配置
区域：Singapore；Web Service 运行时：Node；构建：npm ci --include=dev && npm run build；启动：npm start。
数据库必须与服务在同一区域，设置 DATABASE_URL 为内部连接串。
PUBLIC_ORIGIN 可留空，Render 中会自动使用 RENDER_EXTERNAL_URL。
如绑定自定义域名，则设置 PUBLIC_ORIGIN 为实际的 https://域名。

短期方案限制
Render 免费 Web Service 闲置15分钟会休眠，下一次访问可能需要约一分钟启动。
Render 免费 Postgres 在创建30天后到期，不可把它当作永久保存记录的方案。
正式到期日以数据库创建时间及 Render 控制台为准。
本目录和源码包不代表已上线；必须完成托管账号连接、创建资源、部署和微信实测。

本地验证
npm ci
npm run build
npm test
测试使用 PGlite 的 PostgreSQL 引擎，验证多人投票、改票、请求去重、历史分页和服务重启后的记录。
正式部署仍需在 Render PostgreSQL 上做部署后的健康检查。

官方参考
https://render.com/docs/free
https://render.com/docs/blueprint-spec
https://render.com/docs/environment-variables
