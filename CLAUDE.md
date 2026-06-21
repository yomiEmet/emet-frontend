# Emet 前端项目协作规矩

- **自主执行授权**：只要确定改动可回滚（独立 commit + revert 路径清晰），就直接动手做，不再逐项列清单让静怡勾选。遇到"重要的事"才停下问授权——重要 = 涉及钱（订阅/订阅 ToS 灰区）、涉及数据丢失、涉及对外暴露/隐私、要花长时间还看不到效果。
- 旧代码迁移必须原样照搬，只做 DOM→React 的必要转换，禁止"理解后重写"。"搬 / 复刻 / 照原版" 这种字面明确指令 = 直接复制粘贴，不要"参考思路"。
- worker.js 全面授权直接编辑部署，做好回滚即可（旧规已废）。
- 每完成一个独立步骤，先 git commit 再继续下一步。每个 commit 要独立可 revert。
- 部署方式：Cloudflare Pages，推 master 自动部署。Build: npm run build，Output: dist。
- 后端地址：emet-memoty-v66.aandxiaobao.workers.dev（拼写就是 memoty，不是 typo）。
- 不要把任何密钥硬编码进代码或提交进仓库。
