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
