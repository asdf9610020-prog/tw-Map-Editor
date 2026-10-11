# tw Map Editor

以 GLB 地形模組製作等角地圖的獨立編輯器，使用 TalesWeaver 868 的通行座標與阻擋位元結構。可在本機匯入既有 PoE2 素材庫，編輯新地圖並匯出完整地圖包。

## 開啟編輯器

需要 Python 3.10 以上；啟動與匯出使用標準函式庫，不需要 pip 或 npm 安裝。

- Windows：執行「開啟tw Map Editor.cmd」。
- Windows、macOS、Linux：在專案目錄執行 `python server.py`，開啟 <http://127.0.0.1:8790/>。
- 指定連接埠：`python server.py --port 8791`。
- 使用自製範例：`python server.py --demo`。

Three.js 已附在 `web/vendor/`，執行時不依賴 CDN。公開專案包含四種自製 GLB 模組及河岸／營地範例；這些範例不是原遊戲還原素材。

## 編輯功能

- 地形放置、拖動、旋轉、複製、刪除與吸附。
- 等角／俯視、滾輪縮放、右鍵或中鍵平移。
- 通行／阻擋筆刷、依地形重算通行、出生點與路線預覽。
- NPC、怪物與出口標記，出口可設定世界／地形／區域。
- 復原／重做、本機草稿還原、JSON 匯入與獨立專案保存。
- ZIP 匯出包含專案、GLB、來源摘要、通行位元、高度及 13×13 格分組。
- 匯出目前取景 PNG。
- 地圖庫：切換研究區域與保存專案前，先保存目前地圖的新副本。
- 地形分類、名稱／原始路徑搜尋，以及用所選地塊建立獨立新地圖。

預設 **512×512 格（128×128 公尺）**，上限 **1024×1024 格（256×256 公尺）**。右側寬／高按「套用尺寸」即可調整；擴張保留原座標、通行位元與高度，新增區域預設阻擋。

快捷鍵：`V` 選取、`T` 地形、`W` 通行、`B` 阻擋、`R` 旋轉、`Delete` 刪除、`Ctrl+Z` 復原、`Ctrl+Y` 重做、`Ctrl+S` 保存。

## 匯入既有素材庫

來源資料夾須具有 `data/catalog.json`、`data/riverbank-template.json`，以及目錄所引用的 `models/` 和 `thumbnails/`。可直接使用原 868 地圖工坊資料夾：

```powershell
python tools/import-library.py --source "你的原編輯器資料夾"
```

同時攜入已保存的新地圖：

```powershell
python tools/import-library.py --source "你的原編輯器資料夾" --project "你的地圖.twmap.json"
```

素材存於 **`local/library/`**，專案存於 **`web/maps/`**；兩者均已排除 Git 追蹤。啟動時自動使用本機素材庫，也可使用 `--library 路徑` 指定另一個庫。公開庫不提供 PoE2／TalesWeaver 的原遊戲模型、貼圖、解析資料表或玩家存檔；匯入功能使用你在本機已有且可使用的資料。

原有地圖 JSON 與匯出包相容。解開 ZIP 後匯入 `map.twmap.json`；其模型也必須存在於目前選用的素材庫。

## 匯入 PoE2 新研究地塊

研究專案已有 `all210-portable-terrain-records.json`（attempt-2）時，可以追加完整來源地塊池。匯入另需 `Pillow`：`python -m pip install Pillow`。

```powershell
python tools/import-poe2-research.py --source "你的PoE2研究專案" --destination "local/research-001"
python server.py --library "local/research-001"
```

工具以 `local/library/` 為基礎，可用 `--base-library` 指定既有素材庫。目的地須為全新的 `local/` 子資料夾；原素材庫、研究檔案與地圖不覆寫。模型及外部 PNG 雜湊逐一檢查，所有幾何／LOD／packed buffer 保留，貼圖另嵌成 512px 預覽。`import-receipt.json` 保存結果。

匯入包含 G1_2 的 210 組來源地塊，以及河岸入口／皆伐營地中央區域兩個可編輯範例。210 組是地塊素材，不是 210 張完整地圖。白色地面、材質混合與原 ARM/TGR 世界排列仍待研究；來源地面三角形的通行預覽未處理物件阻擋、水深或角色淨空，須用筆刷及試走檢查。既有研究版範例沿用其已解析的通行資料。

本機可在 `local/library-settings.json` 保存 `{"library":"research-001"}`，讓預設啟動器使用該庫；此設定也不公開。

## 通行資料與接入範圍

`twremake.authored-map.v1` 使用 row-major 通行位元與高度陣列；原生座標為格座標的 4 倍，`flags & 0x02` 代表阻擋，依 13×13 格分組。預設一格對應 0.25 公尺是本工具的轉換政策。

試走採四方向與 0.45 公尺高度差限制，供編輯預覽。此工具尚未輸出原生 `.d2m`，也未接入正式遊戲載入器、伺服器、角色資料或 NPC／怪物行為。匯出強制保留 `runtimeIntegrated=false` 及兩端玩法未驗收標記。

## 開發與檢查

```sh
node --test tests/model.test.mjs
python -m unittest discover -s tests -p "test_*.py"
```

瀏覽器檢查另需開發依賴：`npm install`、`npx playwright install chromium`，啟動 `python server.py --demo` 後執行 `npm run test:browser`。

重新生成自製範例：`python tools/make-demo.py`。第三方聲明見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
