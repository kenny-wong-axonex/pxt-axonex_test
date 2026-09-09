
> Open this page at [https://kenny-wong-axonex.github.io/pxt-axonex_test/](https://kenny-wong-axonex.github.io/pxt-axonex_test/)

## Use as Extension

This repository can be added as an **extension** in MakeCode.

* open [https://makecode.microbit.org/](https://makecode.microbit.org/)
* click on **New Project**
* click on **Extensions** under the gearwheel menu
* search for **https://github.com/kenny-wong-axonex/pxt-axonex_test** and import

## Edit this project

To edit this repository in MakeCode.

* open [https://makecode.microbit.org/](https://makecode.microbit.org/)
* click on **Import** then click on **Import URL**
* paste **https://github.com/kenny-wong-axonex/pxt-axonex_test** and click import

#### Metadata (used for search, rendering)

* for PXT/microbit
<script src="https://makecode.com/gh-pages-embed.js"></script><script>makeCodeRender("{{ site.makecode.home_url }}", "{{ site.github.owner_name }}/{{ site.github.repository_name }}");</script>

---

## 開發環境筆記（ESP-IDF + 睇 log）

呢部機用官方 ESP-IDF Windows installer 裝咗 ESP-IDF，所有嘢喺 `C:\Espressif`，有齊 v5.2.2 / v5.5.4 / v6.0.1。

### 啟動 ESP-IDF 5.5.4 環境

⚠️ **要用 installer 生成嘅 profile script**，唔好用 esp-idf 入面個 `export.ps1`（嗰個 venv 路徑唔同，會報 `python_env ... not found`）。

**Windows PowerShell：**

```powershell
. C:\Espressif\tools\Microsoft.v5.5.4.PowerShell_profile.ps1
idf.py --version   # ESP-IDF v5.5.4
```

**macOS / Linux（bash）：**

```bash
. $IDF_PATH/export.sh
idf.py --version
```

### 搵 port

> ⚠️ `ls /dev/cu.*` 係 **macOS / Linux 先有**，Windows 用唔到（會彈 `Cannot find path 'C:\dev'`）。

**Windows（用 idf 環境個 Python，推薦）：**

```powershell
python -m serial.tools.list_ports -v
```

**Windows（PowerShell 內建，唔使啟動 env）：**

```powershell
Get-PnpDevice -Class Ports -Status OK | Select-Object FriendlyName
```

**macOS / Linux（bash）：**

```bash
ls /dev/cu.*
```

會睇到類似：

```
COM4
    desc: USB Serial Device (COM4)
    hwid: USB VID:PID=0D28:0204 ...
```

分辨裝置（睇 VID:PID）：

| VID:PID | 裝置 |
|---|---|
| `0D28:0204` | BBC micro:bit |
| `303A:xxxx` | ESP32（R300） |

### 監察 serial log

**micro:bit（MakeCode）**：`main.ts` 用咗 `sendBoth()` + `console.log` 將所有 TX/RX mirror 去 USB（`console.log` 行 USB debug channel，同 `serial.redirect()` 無關），所以**唔使撳 Button A** 都睇到。

```powershell
python -m serial.tools.miniterm COM4 115200
```

會見到：

```
Hello World!                        ← boot
[TX] {"cmd":"get_status"}           ← micro:bit 發出（去 P0/P1）
[RX] {"cmd":"system_status",...}    ← R300 回返嚟
```

**micro:bit dev 模式**：撳住 Button A 開機 → serial 留喺 USB（唔去 P0/P1），可以經 USB 直接同 micro:bit 通訊／測試。

**R300（ESP32，用 idf）**：

```powershell
idf.py -p COMx monitor
```

（`COMx` 換成 R300 個 port；退出撳 `Ctrl+]`）

### 本地 build & flash（micro:bit）

```powershell
pxt build
Copy-Item built\binary.hex D:\ -Force   # D: = MICROBIT 磁碟
```

（首次要先 `npm install -g pxt` 同 `pxt target microbit`）
