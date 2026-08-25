# 参与 Form2Offer

## 开始开发

需要 Node.js 20 或更高版本。扩展没有运行时第三方依赖。

```powershell
git clone https://github.com/gaaiyun/Form2Offer.git
cd Form2Offer
npm run verify
```

在 `chrome://extensions` 或 `edge://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，加载仓库根目录。

## 提交范围

- 一个 Pull Request 解决一个清晰问题。
- 新增字段别名、ATS 规则或复杂控件支持时，添加对应自动化测试。
- 保持 `activeTab + scripting + storage` 的最小权限设计；新增权限必须解释用途和替代方案。
- 不自动处理上传、验证码、声明确认或最终提交。
- 不把 API Key、真实履历、Cookie、完整私有页面或个人资料提交到仓库。

## ATS 样例

优先提交最小化、匿名化 HTML fixture。删除公司内部标识、姓名、邮箱、电话、证件号、申请编号、Cookie、查询令牌和不可公开页面正文。无法安全匿名化时，只提交字段标签、控件结构和复现说明。

## 验证

```powershell
npm run verify
```

涉及页面行为或界面时，还应运行 `node scripts/qa-extension-smoke.js`。浏览器环境变量见 `docs/qa/browser-smoke.md`。

## Commit

使用简洁的 Conventional Commit，例如：

- `feat(ats): 支持新的日期下拉控件`
- `fix(profile): 保留导入的自定义字段`
- `test(safety): 覆盖声明类字段`
