# Browser smoke test

浏览器冒烟测试会临时复制扩展、加载本地 fixture，并检查设置页、弹窗、投递追踪、日期下拉、项目重复区块和安全填写策略。

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
- 浏览器控制台没有错误。

2026-08-25 的本地 Chromium 回归结果：69 项 Node 测试通过；项目场景填写 20 个字段，无关新增 0，提交 0，浏览器错误 0。
