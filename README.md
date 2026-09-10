# Protocol Flow Export

Node.js 20+。邮箱部分调用 vfutai 的 JSON API，Weee 页面由 Playwright 操作；浏览器既支持本机 Chromium，也支持通过 CDP 连接比特浏览器指纹窗口。

## 配置

1. 如果没有 `.env`，从 `.env.example` 复制一份；已有配置不要覆盖。
2. 在本地 `.env` 填写 vfutai 提供的 `TEMP_MAIL_TOKEN`，以及对应的 `TEMP_MAIL_SEED` 和 `TEMP_MAIL_DOMAIN`。不要把令牌提交到版本库。
3. 安装依赖和浏览器：

```sh
npm install
npx playwright install chromium
```

如果使用比特浏览器，请先启动 BitBrowser 的 Local Server，并将 `bitbrowser.config.example.json` 复制为 `bitbrowser.config.json`，在 `browserIds` 中填写一个或多个指纹浏览器 ID。项目已经为当前配置准备了一个本地 `bitbrowser.config.json`，该文件被 `.gitignore` 忽略。

## 打包给客户一键运行

客户不需要安装 Node.js。打包机只需要执行一次：

```sh
npm install
CLIENT_RUN_PASSWORD=你的运行密码 npm run build:client:mac
```

也可以在项目根目录创建被 `.gitignore` 忽略的 `client-password.txt`，写入运行密码后直接执行 `npm run build:client:mac`。

生成的 macOS ARM 客户端在 `dist/weee-flow-macos-arm64.zip`。解压后客户只需要：

1. 启动 BitBrowser 的 Local Server。
2. 编辑 `.env` 填写自己的 `TEMP_MAIL_TOKEN`。
3. 编辑 `.env` 填写固定的 `PAYMENT_CVV` 和 `PAYMENT_POSTAL_CODE`。
4. 编辑 `bitbrowser.config.json` 填写自己的指纹浏览器 ID；代理可填 `proxyUrl`。
5. 将卡片逐行写入 `cards.txt`，格式为 `卡号|MM|YYYY`。
6. 双击 `启动.command`。

Windows 版本需要在 Windows x64 打包机执行 `npm run build:client:win`，生成 `dist/weee-flow-win-x64.zip`，客户双击 `启动.bat`。压缩包中的客户端已经包含 Node.js 运行时；BitBrowser 本身仍需要客户安装并启动。默认使用 BitBrowser 时不需要额外下载 Playwright Chromium。

交付包根目录只暴露 `.env`、`bitbrowser.config.json`、`cards.txt`、启动脚本和说明文件。程序源码、依赖和内置 Node 运行时放在隐藏目录 `.weee-runtime`。交付前可以运行 `./weee-flow-macos-arm64 --check-package`，应输出 `portable: true`。不要把含有真实邮箱令牌或支付卡信息的本地 `.env` 直接发给客户；打包脚本会从 `.env.example` 生成空白模板。

## GitHub 手动构建 Windows 包

仓库中的 `.github/workflows/build-windows.yml` 只有 `workflow_dispatch` 触发器，不会在 push、提交或 Pull Request 时自动打包。把代码提交到 GitHub 后，在仓库页面点击 **Actions → 手动构建 Windows 客户端 → Run workflow**，完成后从该次运行的 Artifacts 下载 Windows 压缩包。

第一次使用前，在仓库 **Settings → Secrets and variables → Actions** 添加：

```text
CLIENT_RUN_PASSWORD=客户运行器密码
```

这个密码用于生成隐藏的 `license.json` 和加密 `workflow.js.enc`。不要把密码写进仓库文件。

流程更新不需要重新构建完整 Windows 包。可以点击 **手动构建加密流程文件** 工作流，使用同一个 `CLIENT_PAYLOAD_PASSWORD` Secret，下载几十 KB 的 `workflow.js.enc` 后覆盖客户包根目录的同名文件。两个 Secret 的值必须相同。

## 只更新加密流程文件

运行器包只需要给客户一次。以后流程有更新时，不需要重新发送 60 MB 左右的运行器压缩包，只生成并发送几十 KB 的 `workflow.js.enc`：

```sh
CLIENT_RUN_PASSWORD=和客户运行器相同的密码 \
  npm run build:payload -- /path/to/workflow.js.enc
```

把生成的 `workflow.js.enc` 覆盖客户包根目录的同名文件即可。运行器会在内存中解密并执行，磁盘上不会生成明文流程文件。加密密码必须和首次交付运行器时使用的密码一致；客户不需要重新安装 Node.js 或 Playwright。

这个方案能防止普通用户直接打开、复制源码，但无法防住有本机管理员权限并进行调试或内存提取的逆向分析。需要更强授权控制时，应把解密密钥放到服务端并按设备发放。

## 运行

```sh
npm run check:mail
BROWSER_HEADLESS=false npm start
```

`check:mail` 生成一个随机地址并读取收件箱。正常情况下发出一次 API 请求，不打开 Weee、不发送邮件。

主流程直接打开 Weee 购物车，点击第一个 `.w-9` 加入推荐商品，再点击 `.h-1500` Checkout。Weee 偶尔会同时挂载两个登录弹窗：程序会判断邮箱输入框是否真正可交互；如果上层弹窗遮挡第一个表单，会先关闭上层弹窗，再填写第一个表单并点击箭头发送验证码。随后通过 `type=receive` 轮询新收到的 Weee 邮件并提取验证码，按四个单字符输入框回填后进入订单结算页。结算页后续会打开支付方式和 Braintree 表单；`prepare` 模式停在支付表单，`payment` 模式按同级目录 `cards.txt` 逐行读取卡片并保存。每行格式为 `cardNumber|MM|YYYY`，有效期输入框填入 `MMYY`，CVV 和 Postal Code 使用 `.env` 中固定的 `PAYMENT_CVV`、`PAYMENT_POSTAL_CODE`。保存后监听 `https://api.sayweee.net/ec/payment/card/braintree/profile/attach/v3`，如果返回 `PY10122` 或 “The number of attempts to bind the card is too frequent. Please try again after 24 hours.”，程序会清理缓存、刷新页面、换临时邮箱，并从当前卡片行继续重试。没有频繁限制时，会比较 `div[data-testid="wid-checkout-payment-list-content-wrapper-card-item-text"]` 的数量，只有数量增加才把原始行写入 `saved-cards.txt`。每个临时邮箱最多保存三张卡，之后清理窗口缓存、刷新页面并换用新邮箱继续。流程不会自动提交最终订单。

## 比特浏览器与多窗口

BitBrowser 的官方接口是本机 Local Server 的 POST API：程序调用 `/browser/open` 获取 `ws` 调试地址，再用 Playwright `connectOverCDP` 连接；流程结束默认只断开自动化连接，不关闭 BitBrowser 窗口。需要自动关闭窗口时，将 `BITBROWSER_CLOSE_ON_EXIT=true`。

可以在 `.env` 中配置：

```env
BROWSER_PROVIDER=bitbrowser
BITBROWSER_API_URL=http://127.0.0.1:54345
BITBROWSER_BROWSER_IDS=7deac3de717c442caad015f63a436f73
BITBROWSER_QUEUE=true
BITBROWSER_CLOSE_ON_EXIT=false
```

也可以使用 `bitbrowser.config.json`：

```json
{
  "provider": "bitbrowser",
  "apiUrl": "http://127.0.0.1:54345",
  "browserIds": ["窗口 ID 1", "窗口 ID 2"],
  "queue": true,
  "parallel": false,
  "closeOnExit": false,
  "proxyUrl": ""
}
```

`browserIds` 填多个 ID 时，默认按顺序复用窗口；设置 `parallel: true` 或 `BROWSER_PARALLEL=true` 会并行运行多个窗口。`BROWSER_DATA_FILE` 的每一行也可以指定 `"browserId"`，该行会固定使用对应的指纹窗口。

客户如果要使用代理，可在 `bitbrowser.config.json` 的 `proxyUrl` 或 `.env` 的 `BITBROWSER_PROXY_URL` 填写完整 URL，例如 `socks5h://用户名:密码@主机:端口`。程序会在启动窗口前调用 BitBrowser 的代理更新接口；`socks5h` 会映射为 BitBrowser 支持的 `socks5`。

API 请求使用一个完整邮箱地址，例如 `aahd1234@drime.space`。邮箱地址中的 `@` 会由 URL 参数自动编码；不要把域名重复拼到 `email` 参数中。邮件最多保留约 20 分钟，令牌和域名到期时间以供应商后台为准。

## 参数

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| TEMP_MAIL_TOKEN | 必填 | vfutai API 令牌 |
| TEMP_MAIL_SEED | `aahd` | 邮箱固定种子，只允许小写字母和数字 |
| TEMP_MAIL_DOMAIN | `drime.space` | 供应商已分配的邮箱域名 |
| TEMP_MAIL_API_URL | `https://mb-d.vfutai.com/y/` | vfutai JSON API 地址 |
| TEMP_MAIL_API_TIMEOUT_MS | 15000 | 单次 API 请求超时（毫秒） |
| BROWSER_CODE_TIMEOUT_MS | 120000 | 收验证码的最长等待（毫秒） |
| BROWSER_MAIL_POLL_MS | 5000 | API 轮询间隔（毫秒） |
| BROWSER_CART_URL | `https://www.weee.com/en/cart` | Weee 购物车页 |
| BROWSER_PROVIDER | `local` | `local` 使用本机浏览器；`bitbrowser` 连接比特浏览器 |
| BROWSER_PARALLEL | false | 多个 BitBrowser 窗口是否并行执行 |
| BROWSER_CHECKOUT_URL | `https://www.weee.com/en/order/checkout?cart_domain=grocery` | Weee 订单结算页 |
| BROWSER_CHECKOUT_MODE | `prepare` | `cart` 回到购物车；`prepare` 打开支付表单后停止；`payment` 填写并保存支付方式 |
| BROWSER_HEADLESS | false | false 显示浏览器窗口 |
| BROWSER_USE_BUNDLED | true | 优先使用已安装的 Playwright Chromium |
| BROWSER_STORAGE_STATE | 空 | 可选的 Weee 浏览器状态文件；留空则每次使用干净会话 |
| BITBROWSER_CONFIG_FILE | `bitbrowser.config.json` | 比特浏览器 JSON 配置文件 |
| BITBROWSER_API_URL | `http://127.0.0.1:54345` | BitBrowser Local Server 地址 |
| BITBROWSER_BROWSER_IDS | 空 | 一个或多个指纹浏览器 ID，逗号或空格分隔 |
| BITBROWSER_QUEUE | true | 按官方队列方式启动窗口，降低多窗口并发启动冲突 |
| BITBROWSER_CLOSE_ON_EXIT | false | 流程结束后是否调用 `/browser/close` 关闭窗口 |
| BITBROWSER_PROXY_URL | 空 | 可选代理 URL，例如 `socks5h://user:password@host:port` |
| PAYMENT_CARD_FILE | `cards.txt` | 卡片逐行输入文件，相对客户包目录解析 |
| PAYMENT_SAVED_FILE | `saved-cards.txt` | 保存成功卡片的原始行记录文件 |
| PAYMENT_MAX_SAVES_PER_MAILBOX | 3 | 每个临时邮箱最多保存的卡片数量 |
| PAYMENT_MAX_RATE_LIMIT_RESTARTS | 20 | 绑卡频繁限制后最多自动清缓存换邮箱重开的次数 |
| PAYMENT_CARD_NUMBER | 空 | `payment` 模式的卡号；仅本地配置 |
| PAYMENT_EXPIRATION_DATE | 空 | `payment` 模式的有效期 |
| PAYMENT_CVV | 空 | `payment` 模式的 CVV |
| PAYMENT_POSTAL_CODE | 空 | `payment` 模式的账单邮编 |

每次轮询都会请求一次 `receive` 接口。HTTP 401/403 提示检查令牌、域名和账户状态；429 提示增加轮询间隔。超时表示本次没有取得可用验证码，不会把错误响应当成验证码。

## 验证状态与限制

`npm test` 执行离线模拟测试：请求参数、邮箱地址格式、验证码提取、旧邮件过滤、限流、网络错误与超时。

程序会确认 Weee 已打开验证码输入界面，再开始轮询邮箱；验证码界面可能以内嵌弹窗留在购物车 URL，不一定跳转到 `/account/verify`。如果没有出现可交互的输入框，会先关闭覆盖层并重新解析底层弹窗，而不是把 `aria-hidden` 的输入框当成可用控件。支付部分沿用了参考流程里的支付面板、Braintree iframe、四个字段和保存按钮选择器。当前实现只保存支付方式，不点击最终下单按钮；真实收信和支付表单是否可用仍取决于 Weee 账户、地址、配送时段和支付校验。若页面出现人机验证，需要按页面提示手动完成；本程序没有绕过人机验证的逻辑。

## 文档

- https://mb-d.vfutai.com/login.html
- https://doc2.bitbrowser.cn/jiekou/liu-lan-qi-jie-kou.html

入口是 `runner.js`，主流程是 `browser-flow.js`，API 客户端是 `temp-mail-api.js`。
