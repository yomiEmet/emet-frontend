# Emet 前端项目协作规矩

- 改动旧功能前,先列出功能清单和文件改动点给静怡勾选,确认后再动手。
- 旧代码迁移必须原样照搬,只做 DOM→React 的必要转换,禁止"理解后重写"。
- worker.js 是红线:永远不要直接编辑或部署它。涉及后端改动时,只输出修改方案和完整代码块,由静怡人工审查并应用。
- 每完成一个独立步骤,先 git commit 再继续下一步。
- 部署方式:Cloudflare Pages,推 master 自动部署。Build: npm run build,Output: dist。
- 后端地址:emet-memoty-v66.aandxiaobao.workers.dev(拼写就是 memoty,不是 typo)。
- 不要把任何密钥硬编码进代码或提交进仓库。