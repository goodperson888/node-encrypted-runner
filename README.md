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

客户不需要安装 Node.js。首次生成运行器壳包：

```sh
npm install
CLIENT_PAYLOAD_PASSWORD='流程文件密码' npm run build:client:mac
```

如果希望壳本身还有独立的启动授权密码，再额外设置 `CLIENT_RUN_PASSWORD`；不设置时客户只需输入流程文件密码。也可以在项目根目录创建被 `.gitignore` 忽略的 `payload-password.txt`，写入流程文件密码后直接执行打包。

生成的 macOS ARM 客户端在 `dist/weee-flow-macos-arm64.zip`。解压后客户只需要：

1. 启动 BitBrowser 的 Local Server。
2. 编辑 `.env` 填写自己的 `TEMP_MAIL_TOKEN`。
3. 编辑 `.env` 填写固定的 `PAYMENT_CVV` 和 `PAYMENT_POSTAL_CODE`。
4. 编辑 `bitbrowser.config.json` 填写自己的指纹浏览器 ID；代理可填 `proxyUrl`。
5. 将卡片逐行写入 `cards.txt`，格式为 `卡号|MM|YYYY`。
6. 双击 `启动.command`。
7. 如果运行失败，查看 `logs/latest.log`；Windows 启动脚本会停在错误窗口，便于截图。

Windows 版本需要在 Windows x64 打包机执行 `npm run build:client:win`，生成 `dist/weee-flow-win-x64.zip`，客户双击 `run.bat`。压缩包中的客户端已经包含 Node.js 运行时；BitBrowser 本身仍需要客户安装并启动。默认使用 BitBrowser 时不需要额外下载 Playwright Chromium。

交付包根目录只暴露 `.env`、`bitbrowser.config.json`、`cards.txt`、启动脚本和说明文件。程序源码、依赖和内置 Node 运行时放在隐藏目录 `.weee-runtime`。交付前可以运行 `./weee-flow-macos-arm64 --check-package`，应输出 `portable: true`。不要把含有真实邮箱令牌或支付卡信息的本地 `.env` 直接发给客户；打包脚本会从 `.env.example` 生成空白模板。

## GitHub 手动构建 Windows 包

仓库中的 `.github/workflows/build-windows.yml` 只有 `workflow_dispatch` 触发器，不会在 push、提交或 Pull Request 时自动打包。仓库只保存运行器壳；在仓库页面点击 **Actions → 手动构建 Windows 客户端 → Run workflow**。构建完成后工作流会同时上传 Artifact，并发布 GitHub Release。

客户可以直接使用这个固定下载地址获取最新版 Windows 壳包：

https://github.com/goodperson888/node-encrypted-runner/releases/latest/download/weee-flow-win-x64.zip

每次成功构建都会更新 `latest` Release。下载 ZIP 后，把本地生成的 `workflow.js.enc` 放到解压后的客户端根目录，再交付给客户。

如果需要给壳增加独立的启动授权密码，可以在仓库 **Settings → Secrets and variables → Actions** 添加：

```text
CLIENT_RUN_PASSWORD=客户运行器密码
```

这个密码只用于生成隐藏的 `license.json`，和流程文件的解密密码相互独立；不设置也可以构建没有独立授权密码的壳。不要把密码写进仓库文件。Windows 工作流默认只构建壳，不包含流程载荷。

## 本地生成加密流程文件

流程源码保留在本地，不提交到 Git。直接在本地生成几十 KB 的加密流程文件：

```sh
FLOW_SOURCE_FILE=/你的本地路径/browser-flow.js \
CLIENT_PAYLOAD_PASSWORD='你为流程文件设置的密码' \
npm run build:payload -- /你的输出路径/workflow.js.enc
```

如果流程文件和当前项目同目录，可以省略 `FLOW_SOURCE_FILE`：

```sh
CLIENT_PAYLOAD_PASSWORD='你为流程文件设置的密码' \
npm run build:payload -- workflow.js.enc
```

为了日常更新更简单，可以在项目根目录创建被 `.gitignore` 忽略的 `payload-password.txt`，写入流程密码。之后每次只执行：

```sh
npm run encrypt
```

这个快捷命令默认读取同目录的 `browser-flow.js`，并生成同目录的 `workflow.js.enc`。生成后把该文件替换到客户壳包根目录即可。

把生成的 `workflow.js.enc` 放进 Windows 壳包根目录即可。运行器启动时会要求输入这里设置的流程密码；如果 `.env` 中配置了 `APP_PAYLOAD_PASSWORD`，则不会提示输入。运行器会在内存中解密并执行，不会在磁盘生成明文流程文件。后续流程更新只替换这个文件，不需要重新构建完整运行器包。

运行器默认把每次启动、普通输出、错误堆栈写入客户端根目录的 `logs/latest.log`。客户包构建时会预创建这个文件，运行器启动后会覆盖并写入本次运行内容；如果客户说“闪退”，先让客户打开这个文件或截图停留窗口。Windows 应从 `run.bat` 启动；`启动.bat` 只是中文别名，`weee-flow-win-x64.bat` 是被它调用的内部脚本。日志就在 `run.bat` 同级目录的 `logs` 文件夹。

这个方案能防止普通用户直接打开、复制源码，但无法防住有本机管理员权限并进行调试或内存提取的逆向分析。需要更强授权控制时，应把解密密钥放到服务端并按设备发放。

## 运行

```sh
npm run check:mail
BROWSER_HEADLESS=false npm start
```

`check:mail` 生成一个随机地址并读取收件箱。正常情况下发出一次 API 请求，不打开 Weee、不发送邮件。

主流程直接打开 Weee 购物车，点击第一个 `.w-9` 加入推荐商品，再点击 `.h-1500` Checkout。Weee 偶尔会同时挂载两个登录弹窗：程序会判断邮箱输入框是否真正可交互；如果上层弹窗遮挡第一个表单，会先关闭上层弹窗，再填写第一个表单并点击箭头发送验证码。随后通过 `type=receive` 轮询新收到的 Weee 邮件并提取验证码，按四个单字符输入框回填后进入订单结算页。结算页后续会打开支付方式和 Braintree 表单；`prepare` 模式停在支付表单，`payment` 模式按同级目录 `cards.txt` 逐行读取卡片并保存。每行格式为 `cardNumber|MM|YYYY`，有效期输入框填入 `MMYY`，CVV 和 Postal Code 使用 `.env` 中固定的 `PAYMENT_CVV`、`PAYMENT_POSTAL_CODE`。保存后监听 `https://api.sayweee.net/ec/payment/card/braintree/profile/attach/v3`，如果返回 `PY10122` 或 “The number of attempts to bind the card is too frequent. Please try again after 24 hours.”，程序会清理缓存、刷新页面、换临时邮箱，并从当前卡片行继续重试。如果返回 `PY10114`，当前行不写入成功记录，恢复卡片列表后立即尝试下一行。进入下一行前会从 `cards.txt` 删除上一行的原始记录；如果当前行触发限流重试，则暂不删除，换邮箱后继续重试。没有频繁限制时，会比较 `div[data-testid="wid-checkout-payment-list-content-wrapper-card-item-text"]` 的数量，只有数量增加才把原始行写入 `saved-cards.txt`。程序下次启动会读取 `saved-cards.txt` 并跳过已经记录成功的原始行，从未完成的行继续；如果需要全量重跑，删除该文件即可。每个临时邮箱最多保存三张卡，之后清理窗口缓存、刷新页面并换用新邮箱继续。流程不会自动提交最终订单。

## 比特浏览器与多窗口

BitBrowser 的官方接口是本机 Local Server 的 POST API：程序调用 `/browser/open` 获取 `ws` 调试地址，再用 Playwright `connectOverCDP` 连接；流程结束默认只断开自动化连接，不关闭 BitBrowser 窗口。需要自动关闭窗口时，将 `BITBROWSER_CLOSE_ON_EXIT=true`。

可以在 `.env` 中配置：

```env
BROWSER_PROVIDER=bitbrowser
BITBROWSER_API_URL=http://127.0.0.1:54345
BITBROWSER_BROWSER_IDS=7deac3de717c442caad015f63a436f73
BITBROWSER_QUEUE=false
BITBROWSER_CLOSE_ON_EXIT=false
```

也可以使用 `bitbrowser.config.json`：

```json
{
  "provider": "bitbrowser",
  "apiUrl": "http://127.0.0.1:54345",
  "browserIds": ["窗口 ID 1", "窗口 ID 2"],
  "queue": false,
  "parallel": false,
  "closeOnExit": false,
  "minRequestIntervalMs": 150,
  "rateLimitRetries": 5,
  "apiToken": "",
  "proxyUrl": ""
}
```

`browserIds` 填多个 ID 时，设置 `parallel: true` 或 `BROWSER_PARALLEL=true` 会同时运行多个窗口；保持 `false` 则按窗口顺序运行。BitBrowser Local API 会全局限速，默认每 150ms 最多发起一个本地接口请求，并在返回“请求太过频繁”时自动重试；窗口很多时可把 `minRequestIntervalMs` 或 `BITBROWSER_MIN_REQUEST_INTERVAL_MS` 调到 300。支付模式下，程序会在同一次启动内建立共享卡片队列，各窗口按队列串行领取 `cards.txt` 的行号，已经领取的行不会再次分配；绑卡频繁限制时，未完成的当前行会重新排到队尾重试。`BROWSER_DATA_FILE` 的每一行也可以指定 `"browserId"`，该行会固定使用对应的指纹窗口。要让多个窗口处理不同卡片，使用同一个共享的 `cards.txt`，不要在每行 `payment` 字段中重复写同一张卡。

每个窗口都会生成独立的随机邮箱地址，验证码 API 请求始终带对应的完整邮箱地址，因此窗口之间不会互相读取验证码。进程内的 `receive` 请求还会自动错开，降低多个窗口同时轮询触发邮箱服务商限流的概率。并行模式会拒绝重复使用同一个 BitBrowser ID；如果 `BROWSER_DATA_FILE` 行数超过窗口数，必须为每行配置唯一的 `browserId`，否则程序会在启动时直接提示配置冲突。

客户如果要使用代理，可在 `bitbrowser.config.json` 的 `proxyUrl` 或 `.env` 的 `BITBROWSER_PROXY_URL` 填写完整 URL，例如 `socks5h://用户名:密码@主机:端口`。程序会在启动窗口前调用 BitBrowser 的代理更新接口；`socks5h` 会映射为 BitBrowser 支持的 `socks5`。如果 BitBrowser 返回代理更新权限不足，默认会写入日志并继续使用窗口里已有的代理配置；设置 `BITBROWSER_PROXY_STRICT=true` 后，代理更新失败会直接停止。

如果 `/browser/open` 返回“权限不足，无法执行此操作”，说明 BitBrowser 本地 API 拒绝了打开窗口。先确认客户登录的 BitBrowser 账号有该窗口权限、窗口 ID 属于当前账号/团队；如果开启了 Local API Token 鉴权，把 token 填到 `.env` 的 `BITBROWSER_API_TOKEN` 或 `bitbrowser.config.json` 的 `apiToken`。客户可以运行 `启动.bat --check-bitbrowser-api` 单独检查 Local API 是否能打开配置中的第一个窗口。

API 请求使用一个完整邮箱地址，例如 `aahd1234@drime.space`。邮箱地址中的 `@` 会由 URL 参数自动编码；不要把域名重复拼到 `email` 参数中。邮件最多保留约 20 分钟，令牌和域名到期时间以供应商后台为准。

## 参数

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| TEMP_MAIL_TOKEN | 必填 | vfutai API 令牌 |
| TEMP_MAIL_SEED | `aahd` | 邮箱固定种子，只允许小写字母和数字 |
| TEMP_MAIL_DOMAIN | `drime.space` | 供应商已分配的邮箱域名 |
| TEMP_MAIL_API_URL | `https://mb-d.vfutai.com/y/` | vfutai JSON API 地址 |
| TEMP_MAIL_API_TIMEOUT_MS | 15000 | 单次 API 请求超时（毫秒） |
| TEMP_MAIL_MIN_REQUEST_INTERVAL_MS | 250 | 同一进程内邮箱 `receive` 请求的最小间隔（毫秒） |
| APP_LOG_FILE | `logs/latest.log` | 运行日志文件路径；设置为 `off` 可关闭日志 |
| BROWSER_CODE_TIMEOUT_MS | 120000 | 收验证码的最长等待（毫秒） |
| BROWSER_MAIL_POLL_MS | 5000 | API 轮询间隔（毫秒） |
| BROWSER_CART_URL | `https://www.weee.com/en/cart` | Weee 购物车页 |
| BROWSER_PROVIDER | `local` | `local` 使用本机浏览器；`bitbrowser` 连接比特浏览器 |
| BROWSER_PARALLEL | false | 多个 BitBrowser 窗口是否并行执行 |
| BROWSER_CHECKOUT_URL | `https://www.weee.com/en/order/checkout?cart_domain=grocery` | Weee 订单结算页 |
| BROWSER_CHECKOUT_MODE | `prepare` | `cart` 回到购物车；`prepare` 打开支付表单后停止；`payment` 填写并保存支付方式 |
| BROWSER_HEADLESS | false | false 显示浏览器窗口 |
| BROWSER_KEEP_OPEN_ON_ERROR | false | true 时验证码或流程失败后保留浏览器窗口，便于排查 |
| BROWSER_USE_BUNDLED | true | 优先使用已安装的 Playwright Chromium |
| BROWSER_STORAGE_STATE | 空 | 可选的 Weee 浏览器状态文件；留空则每次使用干净会话 |
| BITBROWSER_CONFIG_FILE | `bitbrowser.config.json` | 比特浏览器 JSON 配置文件 |
| BITBROWSER_API_URL | `http://127.0.0.1:54345` | BitBrowser Local Server 地址 |
| BITBROWSER_BROWSER_IDS | 空 | 一个或多个指纹浏览器 ID，逗号或空格分隔 |
| BITBROWSER_QUEUE | false | true 时给 `/browser/open` 传队列参数；默认不传，兼容 7.1.4 |
| BITBROWSER_CLOSE_ON_EXIT | false | 流程结束后是否调用 `/browser/close` 关闭窗口 |
| BITBROWSER_MIN_REQUEST_INTERVAL_MS | 150 | 多窗口并行时 BitBrowser Local API 请求之间的最小间隔 |
| BITBROWSER_RATE_LIMIT_RETRIES | 5 | BitBrowser 返回请求频繁时的自动重试次数 |
| BITBROWSER_API_TOKEN | 空 | BitBrowser 开启 Local API Token 鉴权时填写 |
| BITBROWSER_PROXY_URL | 空 | 可选代理 URL，例如 `socks5h://user:password@host:port` |
| BITBROWSER_PROXY_STRICT | false | true 时代理 API 更新失败就停止；false 时继续使用窗口已有代理 |
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

`npm test` 执行离线模拟测试：请求参数、邮箱地址格式、验证码提取、旧邮件过滤、限流、网络错误与超时。测试命令不依赖 shell 的 `*.test.js` 通配符，可以直接在 macOS、Linux 和 Windows 上运行。

程序会确认 Weee 已打开验证码输入界面，再开始轮询邮箱；验证码界面可能以内嵌弹窗留在购物车 URL，不一定跳转到 `/account/verify`。如果没有出现可交互的输入框，会先关闭覆盖层并重新解析底层弹窗，而不是把 `aria-hidden` 的输入框当成可用控件。支付部分沿用了参考流程里的支付面板、Braintree iframe、四个字段和保存按钮选择器。当前实现只保存支付方式，不点击最终下单按钮；真实收信和支付表单是否可用仍取决于 Weee 账户、地址、配送时段和支付校验。若页面出现人机验证，需要按页面提示手动完成；本程序没有绕过人机验证的逻辑。

## 文档

- https://mb-d.vfutai.com/login.html
- https://doc2.bitbrowser.cn/jiekou/liu-lan-qi-jie-kou.html

入口是 `runner.js`，主流程是 `browser-flow.js`，API 客户端是 `temp-mail-api.js`。
