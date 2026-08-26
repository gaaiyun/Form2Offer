# Browser smoke test

浏览器冒烟测试会临时复制扩展、加载本地 fixture，并检查设置页、弹窗、投递追踪、本地问答记忆、日期下拉、项目重复区块和安全填写策略。

## 环境变量

```powershell
$env:PLAYWRIGHT_CORE_PATH='path\to\playwright-core'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE='path\to\chrome.exe'
node scripts/qa-extension-smoke.js
```

fixture 默认地址为 `http://127.0.0.1:4173/tests/fixtures/`。运行测试前可在仓库根目录启动只读静态服务器：

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

## 通过条件

- 桌面、手机、弹窗和追踪页没有横向滚动。
- 项目资料只扩展项目区块，不触发教育等无关“添加”按钮。
- 默认策略保留网页已有值，并跳过敏感及声明字段。
- 开启对应策略后只解锁该风险类别。
- 上传和最终提交按钮触发次数为零。
- 开放题可在主动保存后按完整题目复用，家庭与承诺声明文本不会进入问答库。
- 浏览器控制台没有错误。
- Agent 方案在确认前不修改页面；确认后只填写普通字段，身份证与上传建议被拒绝，提交和上传触发次数均为零。

2026-08-26 的本地 Chromium 回归结果：93 项 Node 测试通过；原有浏览器冒烟无控制台错误；Agent 闭环接受 1 个普通字段、拒绝 2 个敏感/上传字段，确认前页面不变，确认后填写 1 项，提交与上传触发均为 0。
